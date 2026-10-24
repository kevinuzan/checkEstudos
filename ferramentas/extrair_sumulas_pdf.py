import re, json, sys
t=open('all.txt',encoding='utf-8').read()
i1=t.index('PARTE 1 – QUESTÕES'); i2=t.index('PARTE 2 – GABARITO COMENTADO')
P1=t[i1:i2]; P2=t[i2:]
def limpa(s):
    s=re.sub(r"\n\s*Súmulas Vinculantes do STF – Questionário estilo FGV • pág\. \d+\s*\n","\n\n",s)
    s=s.replace("\f","")
    return s
P1=limpa(P1); P2=limpa(P2)
# índice área
idx=dict((int(a),b.strip()) for a,b in re.findall(r"(?m)^\s*SV (\d+)\s{2,}(Direito[^\n]+?)\s*$",t[:i1]))
# resumo gabarito (tabela)
resumo={}
for m in re.finditer(r"(?m)^\s*SV (\d+)\s{3,}((?:[A-E]\*?\s*){4,5})$",P2[:P2.index('Súmula Vinculante nº 1\n')]):
    resumo[int(m.group(1))]=re.findall(r"[A-E]\*?",m.group(2))
sums=re.split(r"(?ms)^Súmula Vinculante nº (\d+) — (.*?)\n(?=Texto:)",P1)
out=[]; erros=[]
for k in range(1,len(sums),3):
    n=int(sums[k]); area=re.sub(r'\s+',' ',sums[k+1]).strip(); corpo=sums[k+2]
    m=re.match(r"\s*Texto:\s*(.*?)\n\s*\n\s*Em palavras de criança:\s*(.*?)\n\s*\n(.*)",corpo,flags=re.S)
    if not m: erros.append(('cabecalho',n)); continue
    texto=re.sub(r"\s+"," ",m.group(1)).strip(); crianca=re.sub(r"\s+"," ",m.group(2)).strip()
    qs=re.split(r"(?m)^Questão (\d+)\.(\d+)\n",m.group(3))
    qlist=[]
    for j in range(1,len(qs),3):
        sv,qn,body=int(qs[j]),int(qs[j+1]),qs[j+2].rstrip()
        if sv!=n: erros.append(('sv_diferente',n,sv,qn))
        alts=re.split(r"(?m)^([A-E])\)\s+",body)
        if len(alts)>=11:
            enun=re.sub(r"\s+"," ",alts[0]).strip()
            letras=alts[1::2]; tx=[re.sub(r"\s+"," ",x).strip() for x in alts[2::2]]
            if letras!=list("ABCDE"): erros.append(('letras',n,qn,letras))
            q={'sv':n,'num':qn,'tipo':'multipla','enunciado':enun,'alternativas':dict(zip(letras,tx))}
        else:
            b=re.sub(r"\(\s*\)\s*Certo\s*\(\s*\)\s*Errado","",body)
            q={'sv':n,'num':qn,'tipo':'certo_errado','enunciado':re.sub(r"\s+"," ",b).strip(),'alternativas':{}}
            if "( ) Certo" not in body: erros.append(('sem_alt_nem_ce',n,qn))
        qlist.append(q)
    out.append({'sv':n,'area':area,'texto':texto,'palavras_de_crianca':crianca,'questoes':qlist})
# gabarito comentado
bl=re.split(r"(?m)^Súmula Vinculante nº (\d+)\s*$",P2.split('Súmula Vinculante nº 1\n',1)[0]+'')  # dummy
parte=P2[P2.index('Súmula Vinculante nº 1\n'):]
gabs={}
for m in re.finditer(r"(?m)^Questão (\d+)\.(\d+) — Gabarito: ([^\n]+)\n",parte): pass
bl=re.split(r"(?m)^Questão (\d+)\.(\d+) — Gabarito: ([^\n]+)\n",parte)
for j in range(1,len(bl),4):
    sv,qn,g,corpo=int(bl[j]),int(bl[j+1]),bl[j+2].strip(),bl[j+3]
    corpo=re.sub(r"(?m)^Súmula Vinculante nº \d+\s*$","",corpo).strip()
    gabs[(sv,qn)]=(g,corpo)
tot=0
for s in out:
    for q in s['questoes']:
        tot+=1
        g=gabs.get((q['sv'],q['num']))
        if not g: erros.append(('sem_gab',q['sv'],q['num'])); continue
        gr,corpo=g
        if q['tipo']=='multipla':
            q['gabarito']=gr[:1]
            ex=re.split(r"(?m)^([A-E])\)\s+",corpo)
            q['explicacoes']={ex[a]:re.sub(r"\s+"," ",ex[a+1]).strip() for a in range(1,len(ex),2)}
            if sorted(q['explicacoes'])!=list("ABCDE"): erros.append(('expl_letras',q['sv'],q['num'],list(q['explicacoes'])))
        else:
            q['gabarito']='C' if 'CERTO' in gr.upper() else 'E'
            q['explicacao']=re.sub(r"\s+"," ",corpo).strip()
        # confere com resumo
        r=resumo.get(q['sv'])
        if r and q['num']<=len(r):
            esperado=r[q['num']-1].rstrip('*')
            if esperado!=q['gabarito']: erros.append(('gab_resumo_diverge',q['sv'],q['num'],esperado,q['gabarito'],gr))
            if (q['tipo']=='certo_errado')!=r[q['num']-1].endswith('*'): erros.append(('tipo_diverge_resumo',q['sv'],q['num']))
        else: erros.append(('sem_resumo',q['sv'],q['num']))
        if len(q.get('explicacoes',{}))==5 and q['gabarito'] not in 'ABCDE': erros.append(('gab_invalido',q['sv'],q['num'],gr))
        if q['tipo']=='multipla' and not (re.match(r"Certa",q['explicacoes'].get(q['gabarito'],'')) or 'pediu' in q['explicacoes'].get(q['gabarito'],'')): erros.append(('expl_gab_nao_certa',q['sv'],q['num']))
    if idx.get(s['sv'])!=s['area']: erros.append(('area_diverge_indice',s['sv'],s['area'],idx.get(s['sv'])))
print('sumulas',len(out),'questoes',tot,'gabs',len(gabs),'resumo',len(resumo))
print('erros',len(erros))
for e in erros[:40]: print(e)
json.dump(out,open('sv.json','w'),ensure_ascii=False,indent=1)
