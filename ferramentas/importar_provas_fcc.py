#!/usr/bin/env python3
"""Importador OFFLINE de provas da FCC (Analista Judiciário - Área Judiciária) para o banco de questões.

Roda na máquina de quem mantém o app (precisa do poppler: pdftotext/pdfinfo), NÃO no servidor.
Lê os PDFs de prova + gabarito, valida e gera um JSON que o servidor carrega no deploy.

Regras de segurança (por que algumas provas/questões ficam de fora):
 - só entra prova com gabarito em TEXTO do cargo certo, com o mesmo nº de questões da prova;
 - o gabarito do tipo de caderno (001, 002...) e do código do caderno (A01, RJ01...) precisa bater;
 - questões que dependem de texto-base, figura, tabela ou gráfico NÃO entram (ainda não guardamos o contexto);
 - questões anuladas ('*'/'X' no gabarito) não entram.
Estrutura por pasta esperada: <raiz>/<ano>/AJAJ/<órgão>/<arquivos .pdf>
"""
import sys, os, re, json, collections, subprocess, unicodedata
def run(cmd): return subprocess.run(cmd, capture_output=True, text=True).stdout
def info(pdf):
    o=run(["pdfinfo",pdf]); pg=int(re.search(r"Pages:\s+(\d+)",o).group(1))
    w=re.search(r"Page size:\s+([\d.]+) x",o); return pg,(float(w.group(1)) if w else 595)
def coluna(pdf,p,x,w):
    return run(["pdftotext","-layout","-f",str(p),"-l",str(p),"-x",str(x),"-y","0","-W",str(w),"-H","842",pdf,"-"])
RUIDO=[r"Caderno de Prova", r"^\s*\d+\s{3,}\S+[-−]\S+\s*$", r"^\s*[A-ZÀ-Ú]+[-−][A-Za-zÀ-ú\.\d\-]+\s+\d+\s*$", r"^\s*\d{1,3}\s*$", r"^\s*www\.", r"fcc\.org\.br", r"^\s*\d{1,3}\s+[A-Z0-9]{3,}[-−]\S+\s*$"]
def gutter(pdf,p,w):
    """Devolve a posição x do vão entre as 2 colunas, ou None se a página é de coluna única.
    Conta quantas palavras cobrem cada x; o vão é a maior faixa quase vazia (<=2 palavras,
    pra tolerar um título centralizado) com >= 8 pt de largura."""
    o=run(["pdftotext","-bbox","-f",str(p),"-l",str(p),pdf,"-"])
    iv=[(float(a),float(b)) for a,b in re.findall(r'xMin="([\d.]+)"[^>]*xMax="([\d.]+)"',o)]
    lo,hi=int(0.3*w),int(0.7*w)
    cob=[sum(1 for a,b in iv if a<=x<=b) for x in range(lo,hi)]
    lim=max(2,0.25*max(cob)) if cob else 2
    melhor=(0,None); ini=None
    for k,c in enumerate(cob+[99]):
        if c<=lim and ini is None: ini=k
        if c>lim and ini is not None:
            if k-ini>melhor[0]: melhor=(k-ini,lo+(ini+k)//2)
            ini=None
    return melhor[1] if melhor[0]>=8 else None
def linhas_prova(pdf,modo):
    pg,w=info(pdf); L=[]
    for p in range(1,pg+1):
        gx=gutter(pdf,p,w)
        if gx:
            L+=coluna(pdf,p,0,gx).splitlines()+coluna(pdf,p,gx,int(w)-gx+2).splitlines()
        else:
            L+=run(["pdftotext","-layout","-f",str(p),"-l",str(p),pdf,"-"]).splitlines()
    return [l for l in L if not any(re.search(r,l) for r in RUIDO)]

def norm(s): return re.sub(r"\s+"," ",unicodedata.normalize('NFKD',s).encode('ascii','ignore').decode().lower()).strip()
CANON=["Língua Portuguesa","Raciocínio Lógico","Informática","Legislação","Direito Constitucional","Direito Administrativo",
 "Direito do Trabalho","Direito Processual do Trabalho","Direito Civil","Direito Processual Civil","Direito Civil e Processual Civil",
 "Direito Penal","Direito Processual Penal","Direito Penal e Processual Penal","Direito Previdenciário","Direito Tributário","Direito Eleitoral",
 "Direito Empresarial","Direito Internacional","Direitos Humanos","Direito Financeiro","Direito Ambiental","Direito do Consumidor",
 "Administração Pública","Ética","Atualidades","Direito da Pessoa com Deficiência","Sustentabilidade","Estatística","Contabilidade","Inglês","Noções Gerais de Direito"]
def mapeia(h):
    """Nome de cabeçalho (possivelmente cortado pela coluna) -> lista de matérias canônicas compatíveis."""
    n=norm(h); n=re.sub(r"^nocoes (de|sobre) ","",n); n=re.sub(r"^nocoes ","",n)
    if n.startswith(("lingua p","portug","lingua")) or n=="p": return ["Língua Portuguesa"]
    if n.startswith(("racioc","matemat")): return ["Raciocínio Lógico"]
    if n.startswith("inform"): return ["Informática"]
    if n.startswith("legisla"): return ["Legislação"]
    if n.startswith(("processo admin","administracao","admin")) and not n.startswith("direito"): return ["Administração Pública" if not n.startswith("processo") else "Direito Administrativo"]
    if n.startswith("etica"): return ["Ética"]
    if n.startswith("atualid"): return ["Atualidades"]
    if n.startswith(("sustent")): return ["Sustentabilidade"]
    if n.startswith("estat"): return ["Estatística"]
    if n.startswith("contab"): return ["Contabilidade"]
    if n.startswith("ingles"): return ["Inglês"]
    if h.startswith("Noções de G"): return []
    if n.startswith("direitos humanos") or n.startswith("direito das pessoas com def") or "deficiencia" in n: return ["Direito da Pessoa com Deficiência" if "defic" in n else "Direitos Humanos"]
    if not n.startswith("direito"): return []
    r=n[len("direito"):].strip()
    mapa=[("constitucional","Direito Constitucional"),("administrativo e","Direito Administrativo"),("administrativo","Direito Administrativo"),
      ("processual do trabalho","Direito Processual do Trabalho"),("do trabalho","Direito do Trabalho"),("trabalho","Direito do Trabalho"),
      ("civil e","Direito Civil e Processual Civil"),("processual civil","Direito Processual Civil"),("civil","Direito Civil"),
      ("penal e","Direito Penal e Processual Penal"),("processual penal","Direito Processual Penal"),("penal","Direito Penal"),
      ("previdenciario","Direito Previdenciário"),("tributario","Direito Tributário"),("eleitoral","Direito Eleitoral"),
      ("empresarial","Direito Empresarial"),("internacional","Direito Internacional"),("financeiro","Direito Financeiro"),
      ("ambiental","Direito Ambiental"),("do consumidor","Direito do Consumidor")]
    for k,v in mapa:
        if r.startswith(k): return [v]
    # cabeçalho cortado: todos os canônicos que começam com o prefixo
    c=[x for x in CANON if norm(x).startswith("direito "+r) or norm(x).startswith("direito"+r)]
    return c
def resolve(h,anterior):
    c=mapeia(h)
    if not c: return None
    if len(c)==1: return c[0]
    # cabeçalho cortado e ambíguo ("Direito Proces"): FCC coloca o processual logo depois do material
    ant=anterior or ""
    for chave,alvo in (("Trabalho","Direito Processual do Trabalho"),("Civil","Direito Processual Civil"),("Penal","Direito Processual Penal")):
        if chave in ant and alvo in c: return alvo
    return c[0]


MARC=re.compile(r"^\s{0,45}(\d{1,3})\.\s+\S")
ALT=re.compile(r"^\s*\(([A-E])\)\s*(.*)$")
FAIXA=re.compile(r"(?i)quest[õo]es?\s+(?:de\s+)?n[úu]meros?\s+(\d+)\s+(?:a|e|ao?|até)\s+(\d+)")
UNICA=re.compile(r"(?i)quest[ãa]o\s+(?:de\s+)?n[úu]mero\s+(\d+)")
DEP=re.compile(r"(?i)(\b(o|no|do|ao|pelo|neste|nesse|no\s+referido)\s+texto\s+(acima|abaixo|apresentado|a\s+seguir|lido|I|II)\b|(segundo|conforme|de acordo com|considerando|com base n?o|baseando-se n?o|a partir do|no contexto d?o)\s+(o\s+)?texto\b(?!\s+(constitucional|legal|da\s+lei|do\s+art|da\s+constitui))|\b(figura|gr[áa]fico|tabela|quadro|diagrama|charge|tirinha|imagem|ilustra[çc][ãa]o|mapa)\b|\bsublinhad|\(linhas?\s+\d|\blinhas?\s+\d+|\bparágrafo\s+d?o\s+texto|\bno\s+trecho\b|\bo\s+trecho\b)")

RODAPE=re.compile(r"\s*(?:TR\w*-[A-Za-z\.\-]*Jud[A-Za-z\.\-]*Judici[áa]ria-\w+|\bursos\.com\.br|www\.pci\S*|_{3,})\s*")
def limpa(t):
    """Tira restos de rodapé, números de linha/página que o PDF mistura ao texto."""
    t=RODAPE.sub(" ",t)
    t=re.sub(r"(\w)- \d{1,2} ([a-zà-ú])",r"\1\2",t)            # 'Fe- 5 deral' (nº de linha no meio da palavra)
    t=re.sub(r"(?<=[\.;?])\s+\d{1,2}$","",t)                 # nº de página colado no fim
    return re.sub(r"\s{2,}"," ",t).strip()
def dehifen(txt): return re.sub(r"(\w)-\s+([a-zà-ú])",r"\1\2",txt)

HEAD=re.compile(r"^\s{6,}((?:Direito|Direitos|Legisla[çc][ãa]o|L[íi]ngua|Portugu[êe]s|Matem[áa]tica|Racioc[íi]nio|No[çc][õo]es|Inform[áa]tica|Administra[çc][ãa]o|Ética|Atualidades|Conhecimentos de|Processo|Estat[íi]stica|Contabilidade|Ingl[êe]s)[A-Za-zÀ-ú ,/\-−–]{0,55})\s*$")
def materia_de(L,i,heads):
    m=None
    for j,h in heads:
        if j<i: m=h
        else: break
    return m
def parse(L):
    L=[l for l in L if not re.match(r"^\s{5,}(o|a|os|as|º|ª)\s*$",l)]
    heads=[]
    for j,l in enumerate(L):
        m=HEAD.match(l)
        if m and not re.search(r"[.:;]$",m.group(1)) and not m.group(1).lower().startswith(("direito de ","direito à","direitos e")):
            heads.append((j,re.sub(r"\s+"," ",m.group(1)).strip()))
    # canoniza os cabeçalhos em sequência (o anterior desambigua cabeçalhos cortados)
    cano=[]; ant=None
    for j,h in heads:
        r=resolve(h,ant)
        if r: cano.append((j,r)); ant=r
    heads=cano
    marc=[]; e=1
    for i,l in enumerate(L):
        m=MARC.match(l)
        if m and int(m.group(1))==e and e<=200:
            marc.append((i,e)); e+=1
    fim=[x[0] for x in marc[1:]]+[len(L)]
    # faixas de questões que dependem de um texto-base ("Atenção: ... questões de números 1 a 6")
    dep=set()
    for l in L:
        m=FAIXA.search(l)
        if m and int(m.group(2))-int(m.group(1))<15:
            dep.update(range(int(m.group(1)),int(m.group(2))+1))
        else:
            m=UNICA.search(l)
            if m: dep.add(int(m.group(1)))
    qs=[]
    for (i,n),f in zip(marc,fim):
        bloco=L[i:f]
        # remove o número
        bloco[0]=MARC.sub(lambda m:" "*0, bloco[0],count=0) if False else re.sub(r"^\s*\d{1,3}\.\s+","",bloco[0])
        idx=[j for j,l in enumerate(bloco) if ALT.match(l)]
        letras=[ALT.match(bloco[j]).group(1) for j in idx]
        # pega a primeira sequência A..E
        seq=None
        for s in range(len(idx)):
            if letras[s]=='A' and letras[s:s+5]==list("ABCDE"): seq=idx[s:s+5]; break
        if not seq:
            qs.append({'n':n,'ok':False,'motivo':'alternativas'}); continue
        enun=bloco[:seq[0]]
        alts={}
        for k,j in enumerate(seq):
            fimalt=seq[k+1] if k+1<5 else len(bloco)
            linhas=[ALT.match(bloco[j]).group(2)]
            for l in bloco[j+1:fimalt]:
                if not l.strip(): break   # linha em branco encerra a alternativa (o resto é texto de outra questão)
                if re.match(r"^\s*_{10,}\s*$",l): break
                linhas.append(l.strip())
            alts[ALT.match(bloco[j]).group(1)]=dehifen("\n".join(linhas)).replace("\n"," ").strip()
        # enunciado: junta linhas; linha em branco vira parágrafo; itens romanos viram linha própria
        partes=[]; atual=[]
        for l in enun:
            s=l.strip()
            if not s or re.match(r"^_{10,}$",s):
                if atual: partes.append(" ".join(atual)); atual=[]
                continue
            if re.match(r"^(I|II|III|IV|V|VI)\s*[\.\-−–]\s+\S",s) and atual:
                partes.append(" ".join(atual)); atual=[]
            atual.append(s)
        if atual: partes.append(" ".join(atual))
        enunc=dehifen("\n".join(partes)) if False else "\n".join(dehifen(p) for p in partes)
        enunc=re.sub(r"\u00ad\s*","",enunc)
        enunc=re.sub(r"\s{2,}"," ",enunc).strip()
        for k in alts: alts[k]=re.sub(r"\s{2,}"," ",re.sub(r"\u00ad\s*","",alts[k]))
        motivo=None
        if n in dep: motivo='texto-base'
        elif DEP.search(enunc+" "+" ".join(alts.values())): motivo='refere-texto-ou-figura'
        elif len(enunc)<15 or any(len(a)<2 for a in alts.values()): motivo='curta'
        enunc=re.sub(r"\bn (?=\d)","nº ",enunc)
        enunc=limpa(enunc); alts={k:limpa(v) for k,v in alts.items()}
        enunc=re.sub(r"(?<=[A-Za-zÀ-ú])\s+\d{1,2}$","",enunc)   # nº de página/linha colado no fim do enunciado
        qs.append({'n':n,'ok':motivo is None,'motivo':motivo,'materia':materia_de(L,i,heads),'enunciado':enunc,'alternativas':alts})
    return qs

def pares(t):
    p=re.findall(r"(?<!\d)(\d{1,3})\s*[-–—]\s*([A-E*X])(?![A-Za-z])",t)
    if len(p)<20: p=re.findall(r"(?m)^\s*(\d{1,3})\s{2,}([A-E*X])\s",t)
    return p
def por_tipo(bloco):
    partes=re.split(r"(?i)tipo\s*(?:de\s*)?gabarito\s*:?\s*(\d)",bloco)
    out={}
    if len(partes)==1:
        d=collections.OrderedDict()
        for n,l in pares(bloco): d.setdefault(int(n),l)
        out['1']=d; return out
    for i in range(1,len(partes),2):
        d=collections.OrderedDict()
        for n,l in pares(partes[i+1]): d.setdefault(int(n),l)
        out.setdefault(partes[i],d)
    return out
def ajaj(bloco):
    cab=re.split(r"(?i)tipo\s*(?:de\s*)?gabarito",bloco,maxsplit=1)[0][:400]
    c=re.sub(r"\s+"," ",cab)
    return bool(re.search(r"(?i)[ÁA]REA JUDICI[ÁA]RIA",c)) and not re.search(r"(?i)\bESP\b|ESPECIALIDADE|OFICIAL|AVALIADOR|EXECU[ÇC][ÃA]O|SEGURAN|INFORM|APOIO",re.split(r"(?i)[ÁA]REA JUDICI[ÁA]RIA",c)[-1])
CABEC=r"(?i)(?=cargo\s*(?:ou\s*op[çc][aã]o)?\s*:?\s*[A-Z0-9]{1,3}\s*[-–]\s)"
def gabarito(pdf,tipo,codigo=None):
    """Gabarito do cargo Analista Judiciário - Área Judiciária, no tipo de caderno pedido.
    Só usa o arquivo inteiro quando ele NÃO tem cabeçalhos de cargo (senão corre o risco de
    pegar o gabarito de outro cargo, que tem o mesmo número de questões)."""
    t=run(["pdftotext","-layout",pdf,"-"])
    blocos=re.split(CABEC,t)
    cabs=len(blocos)-1
    sel=[b for b in blocos if ajaj(b)]
    def cod(b):
        m=re.match(r"(?is)cargo\s*(?:ou\s*op[çc][aã]o)?\s*:?\s*([A-Z0-9]{1,3})\s*[-–]",b); return m.group(1).upper() if m else None
    if codigo and len(sel)>1:
        # vários blocos de Analista Judiciário - Área Judiciária (ex.: regiões diferentes): usa o do código do caderno
        so=[b for b in sel if cod(b)==codigo.upper()]
        if not so: return None,'vários blocos de Área Judiciária e nenhum com o código %s do caderno'%codigo
        sel=so
    if sel: fonte=sel
    elif cabs==0: fonte=[t]
    else: return None,'gabarito sem bloco identificável de Analista Judiciário - Área Judiciária'
    tipos={}
    for b in fonte:
        for k,v in por_tipo(b).items(): tipos.setdefault(k,v)
    return tipos.get(str(tipo)), None


def main(raiz,saida,relatorio_saida):
    por=collections.defaultdict(lambda: {'prova':[],'gabarito':[]})
    for base,_,files in os.walk(raiz):
        rel=os.path.relpath(base,raiz).split(os.sep)
        if len(rel)<3: continue
        ano,cargo,orgao=rel[0],rel[1],rel[2]
        if cargo!='AJAJ': continue
        for f in files:
            if not f.lower().endswith('.pdf'): continue
            n=f.lower()
            if 'justificativa' in n or 'altera' in n: continue
            papel='gabarito' if ('gabarito' in n or n.startswith('gab')) else 'prova'
            por[(ano,orgao)][papel].append(os.path.join(base,f))
    saida_q=[]; relat=[]
    for (ano,orgao),v in sorted(por.items()):
        if not v['prova']: continue
        pdf=v['prova'][0]
        txt=run(["pdftotext","-layout",pdf,"-"])
        rel={'ano':ano,'orgao':orgao,'prova':os.path.basename(pdf),'status':None}
        if len(txt.split())<2500:
            rel['status']='prova escaneada (sem texto)'; relat.append(rel); continue
        L=linhas_prova(pdf,None)
        qs=parse(L); N=len(qs); rel['questoes']=N
        mc=re.search(r"Caderno de Prova\s*[’'`´]?\s*([A-Za-z0-9]{2,4})\s*[’'`´]?\s*,\s*Tipo\s*0*(\d)",run(['pdftotext','-layout','-f','1','-l','3',pdf,'-']))
        codigo,tipo=(mc.group(1),mc.group(2)) if mc else (None,'1')
        rel['codigo']=codigo; rel['tipo']=tipo
        g=None; motivo='sem gabarito em texto (só imagem)'
        for gpdf in v['gabarito']:
            if len(run(["pdftotext","-layout",gpdf,"-"]).split())<40: continue
            try: cand,m=gabarito(gpdf,tipo,codigo)
            except Exception as ex_: cand,m=None,str(ex_)
            if cand and sorted(cand)==list(range(1,N+1)):
                g=cand; rel['gabarito']=os.path.basename(gpdf); rel['prelim']=bool(re.search(r"prelim",gpdf,re.I)); break
            motivo=m or 'gabarito com %s respostas para %d questões'%(len(cand) if cand else 0,N)
        if not g:
            rel['status']=motivo; relat.append(rel); continue
        rel['status']='ok'; rel['aproveitadas']=0; rel['anuladas']=0
        for q in qs:
            l=g[q['n']]
            if l not in "ABCDE": rel['anuladas']+=1; continue
            if not q['ok']: continue
            slug=re.sub(r"[^a-z0-9]+","-",orgao.lower()).strip("-")
            saida_q.append({'chave':'fcc-%s-%s-%d'%(ano,slug,q['n']),'banca':'FCC','orgao':orgao,'ano':int(ano),'cargo':'Analista Judiciário - Área Judiciária',
                'numero':q['n'],'materia':q.get('materia') or 'Matéria não identificada','tipo':'multipla','enunciado':q['enunciado'],
                'alternativas':q['alternativas'],'gabarito':l,'gabaritoPreliminar':rel['prelim']})
            rel['aproveitadas']+=1
        relat.append(rel)
    json.dump(saida_q,open(saida,'w',encoding='utf-8'),ensure_ascii=False,indent=1)
    json.dump(relat,open(relatorio_saida,'w',encoding='utf-8'),ensure_ascii=False,indent=1)
    oks=[r for r in relat if r['status']=='ok']
    print('provas aproveitadas:',len(oks),'| questões:',len(saida_q))
    for r in relat: print(r['ano'],r['orgao'],r['status'],r.get('aproveitadas',''))

if __name__=='__main__':
    if len(sys.argv)<4: sys.exit('uso: python importar_provas_fcc.py <pasta FCC> <saida.json> <relatorio.json>')
    main(sys.argv[1],sys.argv[2],sys.argv[3])
