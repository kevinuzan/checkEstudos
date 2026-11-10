#!/usr/bin/env python3
"""Importador OFFLINE de provas da VUNESP para o banco de questões (mesmo formato do da FCC).

Reaproveita o leitor de colunas/questões do importar_provas_fcc.py (precisa do poppler: pdftotext/pdfinfo).
Roda na máquina de quem mantém o app, NÃO no servidor. Uso:
  python importar_provas_vunesp.py <prova.pdf> <gabarito.pdf> <ano> <órgão> "<cargo>" <saida.json> [<saida.json existente para acrescentar>]

Mesmas regras de segurança do importador da FCC:
 - o gabarito (em texto) precisa ter o mesmo nº de questões da prova;
 - questões que dependem de texto-base, figura, tabela ou gráfico NÃO entram (ainda não guardamos o contexto);
 - questões anuladas ('*'/'X' no gabarito) não entram.
Diferença da VUNESP: o texto-base vem anunciado como "Leia o texto para responder às questões de 01 a 05" —
as questões dessa faixa são descartadas (a regex da FCC não reconhece esse formato).
"""
import sys, re, json, unicodedata
import importar_provas_fcc as f

# Ruído específico dos cadernos da VUNESP (rodapé "Confidencial...", nº da página, código da prova).
f.RUIDO += [r"Confidencial at[ée] o momento", r"^\s*TJSP\d+/\S+", r"^\s*pcimark", r"pciconcursos"]
FAIXA_V = re.compile(r"(?i)quest[õo]es\s+de\s+(\d+)\s+a\s+(\d+)")

GUTTER_X = 300  # pt: vão fixo entre as 2 colunas (A4). O detector automático da FCC erra quando o nº da questão
                # "pendura" na margem da coluna da direita (ex.: "64." em x=304) e corta a questão inteira.

def linhas_prova_vunesp(pdf):
    pg, w = f.info(pdf)
    L = []
    for p in range(1, pg + 1):
        L += f.coluna(pdf, p, 0, GUTTER_X).splitlines() + f.coluna(pdf, p, GUTTER_X, int(w) - GUTTER_X + 2).splitlines()
    return [l for l in L if not any(re.search(r, l) for r in f.RUIDO)]

def linhas_normalizadas(pdf):
    L = linhas_prova_vunesp(pdf)
    out = []
    for l in L:
        s = l.strip()
        # Cabeçalhos em caixa alta que o leitor da FCC não reconhece como matéria.
        if s == "LÍNGUA PORTUGUESA": l = " " * 30 + "Língua Portuguesa"
        # Título de matéria com um número de página/linha colado no fim ("Direito Constitucional      3").
        if re.match(r"^\s{6,}[A-Za-zÀ-ú ]{6,50}\s{3,}\d{1,2}\s*$", l): l = re.sub(r"\s{3,}\d{1,2}\s*$", "", l)
        # Número solto na ponta direita da linha (marca invisível no PDF, longe do texto): vira ruído
        # dentro da frase ("...tendo em vista que  2 / a supressão"). Só some se houver um vão grande antes.
        l = re.sub(r"(?<=\S)\s{8,}\d{1,2}\s*$", "", l)
        out.append(l)
    return out

def ordinais(t):
    """O PDF perde o sobrescrito: 'Lei no 9.099/95' era 'Lei nº', '245o termo' era '245º'."""
    t = re.sub(r"\bno (?=\d{1,3}\.\d{3}|\d{1,4}/\d)", "nº ", t)
    t = re.sub(r"\b(\d{1,4})o\b", r"\1º", t)
    return t

def gabarito_vunesp(pdf):
    # Gabarito só em imagem no PDF (ex.: 2021): vem transcrito num .json {"gabarito": {"1": "A", ...}}.
    if pdf.lower().endswith('.json'):
        return {int(k): v for k, v in json.load(open(pdf, encoding='utf-8'))['gabarito'].items()}
    t = f.run(["pdftotext", "-layout", pdf, "-"])
    d = {}
    for n, l in f.pares(t): d.setdefault(int(n), l)
    return d

def main(prova, gab, ano, orgao, cargo, saida, existente=None):
    L = linhas_normalizadas(prova)
    # Faixas com texto-base: marca as questões como dependentes ANTES de parsear.
    dep = set()
    for l in L:
        m = FAIXA_V.search(l)
        if m and int(m.group(2)) - int(m.group(1)) < 15:
            dep.update(range(int(m.group(1)), int(m.group(2)) + 1))
    qs = f.parse(L)
    g = gabarito_vunesp(gab)
    N = len(qs)
    if sorted(g) != list(range(1, N + 1)):
        sys.exit(f"ERRO: prova tem {N} questões lidas, gabarito tem {len(g)} respostas — não importo.")
    # Sem acento no slug (a chave da questão vira id no banco): "Técnico" -> "tecnico", não "t-cnico".
    slug = re.sub(r"[^a-z0-9]+", "-", unicodedata.normalize('NFKD', f"{orgao}-{cargo}").encode('ascii', 'ignore').decode().lower()).strip("-")
    novas, motivos = [], {}
    for q in qs:
        letra = g[q['n']]
        if letra not in "ABCDE": motivos[q['n']] = 'anulada'; continue
        if q['n'] in dep: motivos[q['n']] = 'texto-base'; continue
        if not q['ok']: motivos[q['n']] = q['motivo']; continue
        txt = q['enunciado'] + ' ' + ' '.join(q['alternativas'].values())
        # Figura/planilha/tabela que só existe como imagem no PDF ("a seguinte planilha:") — sem ela a questão não faz sentido.
        if re.search(r"(?i)\b(seguinte|seguintes|abaixo|a seguir)\b[^.]{0,25}\b(planilha|figura|tabela|gr[áa]fico|quadro|imagem|diagrama|tela)\b|\b(planilha|figura|tabela|gr[áa]fico|quadro|imagem|diagrama)\b[^.]{0,25}\b(a seguir|abaixo|seguinte)\b", txt):
            motivos[q['n']] = 'figura-ou-tabela'; continue
        # Lacuna ("____") que sumiu na leitura: sobra espaço antes de pontuação ("estiverem , os preços") ou o enunciado
        # fala em "lacunas". Sem o espaço em branco marcado, a questão não dá pra responder.
        if re.search(r"(?i)\blacunas?\b|\w\s+[,;]\s|\se\s+\.", q['enunciado']) :
            motivos[q['n']] = 'lacuna'; continue
        # Caractere de controle = lacuna/símbolo que o PDF não traduziu em texto (ex.: "era meio-dia e ____"): enunciado incompleto.
        if re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", txt):
            motivos[q['n']] = 'texto-com-lacuna-perdida'; continue
        novas.append({'chave': f"vunesp-{ano}-{slug}-{q['n']}", 'banca': 'VUNESP', 'orgao': orgao, 'ano': int(ano), 'cargo': cargo,
                      'numero': q['n'], 'materia': q.get('materia') or 'Matéria não identificada', 'tipo': 'multipla',
                      'enunciado': ordinais(q['enunciado']), 'alternativas': {k: ordinais(x) for k, x in q['alternativas'].items()}, 'gabarito': letra, 'gabaritoPreliminar': False})
    base = []
    if existente:
        try: base = [x for x in json.load(open(existente, encoding='utf-8')) if not x['chave'].startswith(f"vunesp-{ano}-{slug}-")]
        except FileNotFoundError: pass
    json.dump(base + novas, open(saida, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f"questões lidas: {N} | aproveitadas: {len(novas)} | descartadas: {len(motivos)}")
    for n, m in sorted(motivos.items()): print(f"  Q{n}: {m}")
    por = {}
    for x in novas: por[x['materia']] = por.get(x['materia'], 0) + 1
    print(por)

if __name__ == '__main__':
    if len(sys.argv) < 7: sys.exit(__doc__)
    main(*sys.argv[1:8])
