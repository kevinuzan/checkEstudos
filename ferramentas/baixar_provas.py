#!/usr/bin/env python3
"""
baixar_provas.py — baixa provas antigas de concursos (prova, gabarito e edital em
PDF) do acervo do estudegratis.com.br, para USO PESSOAL DE ESTUDO.

Por que existe: alimentar a seção "Provas Antigas" do Direto à Posse. Este script
só BAIXA e ORGANIZA os arquivos; a extração das questões é uma etapa separada.

Boas maneiras embutidas (não são opcionais):
  - lê o robots.txt do site e obedece (inclusive Crawl-delay);
  - faz uma pausa entre os pedidos (padrão: 2 s);
  - se o site responder 403/429, PARA na hora — não tenta contornar bloqueio;
  - retoma de onde parou (o que já foi baixado e é um PDF válido é pulado).

Direitos autorais: as provas são de propriedade das bancas. Guarde para o seu
estudo. Não suba os PDFs para o repositório nem os redistribua sem avaliar o
risco (por isso a pasta de saída deve ficar no .gitignore).

Instalação (uma vez):
    pip install requests beautifulsoup4

Exemplos:
    # Simula, sem baixar nada: provas do TRT, Analista Judiciário - Área Judiciária
    python baixar_provas.py --dry-run

    # Baixa de verdade (padrão: tag "analista-judiciario-area-judiciaria", busca "TRT")
    python baixar_provas.py --saida provas_baixadas

    # Só FCC, de 2018 em diante, sem oficial de justiça nem prova discursiva
    python baixar_provas.py --banca FCC --ano-min 2018 \\
        --excluir "Oficial de Justiça" --excluir "Discursiva"

    # Uma região específica (use a tag do site, ex.: trt-2a-regiao)
    python baixar_provas.py --tag trt-2a-regiao --busca "Analista Judiciário"

    # Links diretos (ex.: PDFs que você achou no site oficial da banca)
    python baixar_provas.py --urls meus_links.txt
    # (uma URL por linha; opcional: "URL | nome da pasta")
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sys
import time
import unicodedata
import urllib.robotparser
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote, urljoin, urlparse

import requests
from bs4 import BeautifulSoup

BASE_PADRAO = "https://www.estudegratis.com.br"
TAG_PADRAO = "analista-judiciario-area-judiciaria"
BUSCA_PADRAO = ["TRT"]
TIMEOUT = (10, 90)  # (conectar, ler) em segundos
TAMANHO_MINIMO_PDF = 1024  # abaixo disso quase certamente não é uma prova


class BloqueadoError(Exception):
    """O site respondeu 403/429: o certo é parar, não insistir."""


class RobotsError(Exception):
    """Não foi possível confirmar o que o robots.txt permite."""


# ----------------------------------------------------------------------------
# Utilidades de texto
# ----------------------------------------------------------------------------

def normalizar(texto: str) -> str:
    """Minúsculas e sem acento, para comparar 'Área' com 'area' sem drama."""
    sem_acento = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", sem_acento).lower().strip()


def slugificar(texto: str, limite: int = 110) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", normalizar(texto)).strip("-")
    return s[:limite].strip("-") or "sem-nome"


def interpretar_titulo(titulo: str) -> dict:
    """
    'FCC - 2016 - TRT - 20ª REGIÃO (SE) - Analista Judiciário - Área: Judiciária'
    -> banca, ano, órgão, região, cargo.
    O título nem sempre segue o padrão; o que não for reconhecido fica vazio.
    """
    partes = [p.strip() for p in titulo.split(" - ") if p.strip()]
    banca = partes[0] if partes else ""
    ano = partes[1] if len(partes) > 1 and re.fullmatch(r"(19|20)\d{2}", partes[1]) else ""
    orgao = partes[2] if len(partes) > 2 else ""
    resto = partes[3:]
    regiao = ""
    if resto and re.search(r"regi[aã]o", resto[0], re.IGNORECASE):
        regiao = resto.pop(0)
    return {
        "banca": banca,
        "ano": ano,
        "orgao": orgao,
        "regiao": regiao,
        "cargo": " - ".join(resto),
    }


# ----------------------------------------------------------------------------
# Acesso ao site (com robots.txt, pausa e parada em bloqueio)
# ----------------------------------------------------------------------------

class Cliente:
    def __init__(self, base: str, pausa: float, contato: str | None):
        self.base = base.rstrip("/")
        self.host = urlparse(self.base).netloc
        ua = "checkEstudos-baixador-de-provas/1.0 (uso pessoal de estudo"
        ua += f"; contato: {contato})" if contato else ")"
        self.user_agent = ua
        self.sessao = requests.Session()
        self.sessao.headers.update({"User-Agent": ua, "Accept-Language": "pt-BR,pt;q=0.9"})
        self.pausa = pausa
        self._ultimo_pedido = 0.0
        # Cada site tem o seu robots.txt e o seu Crawl-delay: guardamos por host,
        # para que links de OUTRO site (ex.: FCC, no modo --urls) obedeçam as regras dele.
        self._robots: dict = {}
        self._atraso: dict = {}
        self._carregar_robots(self.base)  # falha cedo se o site-base não puder ser conferido

    def pausa_efetiva(self, host: str | None = None) -> float:
        return max(self.pausa, self._atraso.get(host or self.host, 0.0))

    def _carregar_robots(self, base_do_host: str) -> None:
        host = urlparse(base_do_host).netloc
        if host in self._robots:
            return
        rp = urllib.robotparser.RobotFileParser()
        url = f"{base_do_host}/robots.txt"
        try:
            resp = self.sessao.get(url, timeout=TIMEOUT)
        except requests.RequestException as err:
            raise RobotsError(f"Não consegui ler {url}: {err}") from err
        if resp.status_code == 200:
            rp.parse(resp.text.splitlines())
        elif resp.status_code == 404:
            rp.parse([])  # sem robots.txt = sem restrições
        else:
            raise RobotsError(
                f"{url} respondeu HTTP {resp.status_code}; sem confirmar as regras do site, não vou baixar."
            )
        self._robots[host] = rp
        atraso = rp.crawl_delay(self.user_agent) or rp.crawl_delay("*")
        self._atraso[host] = float(atraso) if atraso else 0.0

    def permitido(self, url: str) -> bool:
        p = urlparse(url)
        if p.netloc not in self._robots:
            try:
                self._carregar_robots(f"{p.scheme}://{p.netloc}")
            except RobotsError as err:
                print(f"  [não consegui confirmar o robots.txt de {p.netloc}, não vou baixar] {err}")
                return False
        return self._robots[p.netloc].can_fetch(self.user_agent, url)

    def _esperar(self, host: str) -> None:
        falta = self.pausa_efetiva(host) - (time.monotonic() - self._ultimo_pedido)
        if falta > 0:
            time.sleep(falta)
        self._ultimo_pedido = time.monotonic()

    def pegar(self, url: str, stream: bool = False, tentativas: int = 3):
        """GET educado. Devolve a resposta, ou None se for 404/proibido pelo robots."""
        if not self.permitido(url):
            print(f"  [robots.txt não permite] {url}")
            return None
        ultimo_erro = None
        for tentativa in range(1, tentativas + 1):
            self._esperar(urlparse(url).netloc)
            try:
                resp = self.sessao.get(url, timeout=TIMEOUT, stream=stream)
            except requests.RequestException as err:
                ultimo_erro = err
                time.sleep(2 * tentativa)
                continue
            if resp.status_code in (403, 429):
                raise BloqueadoError(f"HTTP {resp.status_code} em {url}")
            if resp.status_code == 404:
                return None
            if resp.status_code >= 500:
                ultimo_erro = f"HTTP {resp.status_code}"
                resp.close()
                time.sleep(2 * tentativa)
                continue
            resp.raise_for_status()
            return resp
        print(f"  [falhou após {tentativas} tentativas] {url} ({ultimo_erro})")
        return None


# ----------------------------------------------------------------------------
# Listagem e páginas de detalhe
# ----------------------------------------------------------------------------

def extrair_links_listagem(html: str, url_pagina: str, host: str) -> dict:
    """{url_da_prova: texto} a partir de uma página de listagem (/provas/<slug>)."""
    soup = BeautifulSoup(html, "html.parser")
    achados: dict = {}
    for a in soup.find_all("a", href=True):
        url = urljoin(url_pagina, a["href"])
        p = urlparse(url)
        if p.netloc != host:
            continue
        caminho = [x for x in p.path.split("/") if x]
        # /provas/<slug>  (e não /provas, /provas/pagina/N, etc.)
        if len(caminho) == 2 and caminho[0] == "provas" and caminho[1] != "pagina":
            limpa = p._replace(query="", fragment="").geturl()
            texto = f"{a.get('title') or ''} {a.get_text(' ', strip=True)}".strip()
            achados.setdefault(limpa, texto)
    return achados


def percorrer_listagem(cli: Cliente, tag: str | None, max_paginas: int):
    """Gera (url, texto) de cada prova, página a página, até acabar."""
    vistos: set = set()
    for n in range(1, max_paginas + 1):
        url = f"{cli.base}/provas" if n == 1 else f"{cli.base}/provas/pagina/{n}"
        if tag:
            url += f"?tag={quote(tag)}"
        resp = cli.pegar(url)
        if resp is None:
            break
        novos = {
            u: t for u, t in extrair_links_listagem(resp.text, url, cli.host).items() if u not in vistos
        }
        if not novos:
            break
        print(f"Página {n}: {len(novos)} provas")
        vistos.update(novos)
        yield from novos.items()
    else:
        print(f"Parei em {max_paginas} páginas (--max-paginas). Aumente se quiser olhar mais.")


def passa_nos_filtros(texto: str, args) -> bool:
    alvo = normalizar(texto)
    if any(normalizar(t) not in alvo for t in args.busca):
        return False
    if any(normalizar(t) in alvo for t in args.excluir):
        return False
    if args.banca and normalizar(args.banca) not in alvo:
        return False
    if args.ano_min or args.ano_max:
        m = re.search(r"\b((?:19|20)\d{2})\b", texto)
        if not m:
            return False
        ano = int(m.group(1))
        if args.ano_min and ano < args.ano_min:
            return False
        if args.ano_max and ano > args.ano_max:
            return False
    return True


def tipo_do_arquivo(url: str) -> str:
    nome = normalizar(Path(urlparse(url).path).name)
    if "gabarito" in nome:
        return "gabarito"
    if "edital" in nome:
        return "edital"
    return "prova"


def extrair_pdfs_detalhe(html: str, url_pagina: str, host: str) -> tuple[str, dict]:
    """(título limpo, {'prova': url, 'gabarito': url, 'edital': url}) da página de uma prova."""
    soup = BeautifulSoup(html, "html.parser")
    h1 = soup.find("h1")
    titulo = h1.get_text(" ", strip=True) if h1 else (soup.title.get_text(strip=True) if soup.title else "")
    pdfs: dict = {}
    for a in soup.find_all("a", href=True):
        url = urljoin(url_pagina, a["href"])
        p = urlparse(url)
        if p.netloc == host and p.path.lower().endswith(".pdf"):
            pdfs.setdefault(tipo_do_arquivo(url), url)
    return titulo, pdfs


# ----------------------------------------------------------------------------
# Download e validação
# ----------------------------------------------------------------------------

def pdf_valido(caminho: Path) -> bool:
    try:
        if caminho.stat().st_size < TAMANHO_MINIMO_PDF:
            return False
        with caminho.open("rb") as f:
            return f.read(5) == b"%PDF-"
    except OSError:
        return False


def baixar_pdf(cli: Cliente, url: str, destino: Path):
    """Baixa para destino. Devolve dict com tamanho e sha256, ou None se falhar/for inválido."""
    resp = cli.pegar(url, stream=True)
    if resp is None:
        return None
    parcial = destino.with_suffix(".part")
    sha = hashlib.sha256()
    total = 0
    destino.parent.mkdir(parents=True, exist_ok=True)
    try:
        with parcial.open("wb") as f:
            for pedaco in resp.iter_content(chunk_size=64 * 1024):
                if pedaco:
                    f.write(pedaco)
                    sha.update(pedaco)
                    total += len(pedaco)
    except requests.RequestException as err:
        print(f"  [download interrompido] {url} ({err})")
        parcial.unlink(missing_ok=True)
        return None
    finally:
        resp.close()
    if not pdf_valido(parcial):
        print(f"  [não é um PDF válido, descartado] {url}")
        parcial.unlink(missing_ok=True)
        return None
    parcial.replace(destino)
    return {"bytes": total, "sha256": sha.hexdigest()}


def processar_prova(cli: Cliente, url_detalhe: str, saida: Path, args, resumo: dict) -> None:
    resp = cli.pegar(url_detalhe)
    if resp is None:
        resumo["falhas"] += 1
        return
    titulo, pdfs = extrair_pdfs_detalhe(resp.text, url_detalhe, cli.host)
    if not titulo or "prova" not in pdfs:
        print(f"  [sem link de prova na página] {url_detalhe}")
        resumo["falhas"] += 1
        return

    info = interpretar_titulo(titulo)
    pasta = saida / slugificar(info["banca"] or "sem-banca") / (info["ano"] or "sem-ano") / slugificar(titulo)
    print(f"→ {titulo}")

    arquivos: dict = {}
    for tipo in ("prova", "gabarito", "edital"):
        if tipo not in pdfs:
            if tipo == "gabarito":
                print("  (sem gabarito nesta página)")
            continue
        if tipo == "edital" and args.sem_edital:
            continue
        destino = pasta / f"{tipo}.pdf"
        if pdf_valido(destino):
            dados = {"bytes": destino.stat().st_size,
                     "sha256": hashlib.sha256(destino.read_bytes()).hexdigest()}
            resumo["ja_existiam"] += 1
            print(f"  {tipo}: já existe, pulando")
        else:
            dados = baixar_pdf(cli, pdfs[tipo], destino)
            if dados is None:
                resumo["falhas"] += 1
                continue
            resumo["baixados"] += 1
            print(f"  {tipo}: ok ({dados['bytes'] / 1024:.0f} KB)")
        arquivos[tipo] = {"url": pdfs[tipo], "arquivo": f"{tipo}.pdf", **dados}

    if "prova" in arquivos:
        meta = {
            "titulo": titulo,
            **info,
            "url_detalhe": url_detalhe,
            "fonte": cli.host,
            "baixado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "arquivos": arquivos,
        }
        (pasta / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")


def processar_urls(cli: Cliente, arquivo_urls: Path, saida: Path, resumo: dict) -> None:
    """Modo links diretos: uma URL de PDF por linha, opcional 'URL | nome da pasta'."""
    for linha in arquivo_urls.read_text(encoding="utf-8").splitlines():
        linha = linha.strip()
        if not linha or linha.startswith("#"):
            continue
        url, _, nome = (p.strip() for p in linha.partition("|"))
        tipo = tipo_do_arquivo(url)
        pasta = saida / "avulsos" / slugificar(nome or Path(urlparse(url).path).stem)
        destino = pasta / f"{tipo}.pdf"
        print(f"→ {url}")
        if pdf_valido(destino):
            resumo["ja_existiam"] += 1
            print("  já existe, pulando")
            continue
        dados = baixar_pdf(cli, url, destino)
        if dados is None:
            resumo["falhas"] += 1
            continue
        resumo["baixados"] += 1
        print(f"  ok ({dados['bytes'] / 1024:.0f} KB)")
        meta = {"titulo": nome or Path(urlparse(url).path).stem, "url_detalhe": "",
                "baixado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "arquivos": {tipo: {"url": url, "arquivo": f"{tipo}.pdf", **dados}}}
        meta_path = pasta / "meta.json"
        if meta_path.exists():  # mesma pasta recebendo prova e gabarito em linhas separadas
            try:
                antigo = json.loads(meta_path.read_text(encoding="utf-8"))
                antigo.setdefault("arquivos", {}).update(meta["arquivos"])
                meta = antigo
            except json.JSONDecodeError:
                pass
        meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")


def reconstruir_manifesto(saida: Path) -> int:
    """Junta todos os meta.json em manifesto.csv (um registro por prova)."""
    linhas = []
    for meta_path in sorted(saida.rglob("meta.json")):
        try:
            m = json.loads(meta_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        pasta = meta_path.parent.relative_to(saida).as_posix()
        arq = m.get("arquivos", {})
        linhas.append({
            "banca": m.get("banca", ""), "ano": m.get("ano", ""), "orgao": m.get("orgao", ""),
            "regiao": m.get("regiao", ""), "cargo": m.get("cargo", ""), "titulo": m.get("titulo", ""),
            "prova": f"{pasta}/prova.pdf" if "prova" in arq else "",
            "gabarito": f"{pasta}/gabarito.pdf" if "gabarito" in arq else "",
            "edital": f"{pasta}/edital.pdf" if "edital" in arq else "",
            "url_detalhe": m.get("url_detalhe", ""),
        })
    campos = ["banca", "ano", "orgao", "regiao", "cargo", "titulo", "prova", "gabarito", "edital", "url_detalhe"]
    with (saida / "manifesto.csv").open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=campos)
        w.writeheader()
        w.writerows(linhas)
    return len(linhas)


# ----------------------------------------------------------------------------
# Programa principal
# ----------------------------------------------------------------------------

def ler_argumentos(argv=None):
    ap = argparse.ArgumentParser(description="Baixa provas antigas de concursos (PDF) para estudo pessoal.")
    ap.add_argument("--saida", default="provas_baixadas", help="pasta de destino (padrão: provas_baixadas)")
    ap.add_argument("--tag", default=TAG_PADRAO,
                    help=f"tag do site que restringe a listagem (padrão: {TAG_PADRAO}); use '' para não usar tag")
    ap.add_argument("--busca", action="append", default=None,
                    help="termo que deve aparecer no título (repetível; padrão: TRT)")
    ap.add_argument("--excluir", action="append", default=[], help="termo que NÃO pode aparecer (repetível)")
    ap.add_argument("--banca", help="ex.: FCC, CESPE, Cebraspe")
    ap.add_argument("--ano-min", type=int)
    ap.add_argument("--ano-max", type=int)
    ap.add_argument("--limite", type=int, default=0, help="máximo de provas a processar (0 = sem limite)")
    ap.add_argument("--max-paginas", type=int, default=40, help="máximo de páginas de listagem (padrão: 40)")
    ap.add_argument("--pausa", type=float, default=2.0, help="segundos entre pedidos (padrão: 2)")
    ap.add_argument("--sem-edital", action="store_true", help="não baixa o edital")
    ap.add_argument("--dry-run", action="store_true", help="só lista o que seria baixado")
    ap.add_argument("--urls", help="arquivo com links diretos de PDF (modo avulso)")
    ap.add_argument("--contato", help="seu e-mail, para constar no User-Agent (opcional, mas educado)")
    ap.add_argument("--base-url", default=BASE_PADRAO, help=argparse.SUPPRESS)  # usado nos testes
    args = ap.parse_args(argv)
    if args.busca is None:
        args.busca = list(BUSCA_PADRAO)
    args.tag = args.tag or None
    return args


def main(argv=None) -> int:
    args = ler_argumentos(argv)
    saida = Path(args.saida)
    resumo = {"baixados": 0, "ja_existiam": 0, "falhas": 0}
    try:
        cli = Cliente(args.base_url, args.pausa, args.contato)
    except RobotsError as err:
        print(f"ERRO: {err}")
        return 2
    print(f"Pausa entre pedidos: {cli.pausa_efetiva():.1f}s | saída: {saida.resolve()}")

    try:
        if args.urls:
            processar_urls(cli, Path(args.urls), saida, resumo)
        else:
            if not args.tag:
                print("Aviso: sem --tag a listagem inteira do site é enorme; limite com --max-paginas.")
            candidatas = []
            for url, texto in percorrer_listagem(cli, args.tag, args.max_paginas):
                if passa_nos_filtros(texto, args):
                    candidatas.append((url, texto))
                    if args.limite and len(candidatas) >= args.limite:
                        break
            print(f"\n{len(candidatas)} provas passam nos filtros.")
            if args.dry_run:
                for url, texto in candidatas:
                    print(f"  {url}")
                print("\n(dry-run: nada foi baixado)")
                return 0
            for url, _ in candidatas:
                processar_prova(cli, url, saida, args, resumo)
    except BloqueadoError as err:
        print(f"\nO SITE BLOQUEOU O ACESSO ({err}). Parei de propósito: tente mais tarde, "
              f"com --pausa maior, e não insista. O que já foi baixado está salvo.")
        resumo["falhas"] += 1
        _fechar(saida, resumo)
        return 3
    except KeyboardInterrupt:
        print("\nInterrompido. É só rodar de novo: o que já foi baixado é pulado.")
        _fechar(saida, resumo)
        return 130

    _fechar(saida, resumo)
    return 0 if resumo["falhas"] == 0 else 1


def _fechar(saida: Path, resumo: dict) -> None:
    if saida.exists():
        n = reconstruir_manifesto(saida)
        print(f"\nManifesto: {saida / 'manifesto.csv'} ({n} provas)")
    print(f"Resumo: {resumo['baixados']} baixados, {resumo['ja_existiam']} já existiam, {resumo['falhas']} falhas")


if __name__ == "__main__":
    sys.exit(main())
