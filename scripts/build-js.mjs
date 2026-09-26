// Minifica/ofusca os arquivos JS do front-end (public/src/app.js e
// public/jogo/src/index.js) usando o terser, mas com um cuidado importante:
// muita coisa nesse projeto é HTML gerado dinamicamente (template strings)
// com atributos tipo onclick="nomeDaFuncao(...)" — se o terser renomear essas
// funções (mangle "toplevel"), os botões param de funcionar, porque o nome
// dentro da string HTML não é atualizado junto.
//
// Solução: antes de minificar, varremos os dois arquivos HTML E os dois
// arquivos JS-fonte atrás de qualquer on(click|change|input|load|mousedown|
// mouseup|keyup|focus)="..." e extraímos TODO IDENTIFICADOR solto ali dentro
// — não só o nome da função chamada, mas também qualquer variável passada
// como argumento (ex: onclick="iniciarRevisao(baralhoAtualId)" precisa
// proteger tanto "iniciarRevisao" quanto "baralhoAtualId": se só a função for
// protegida, o terser renomeia a variável global "baralhoAtualId" pra um nome
// curto tipo "a", mas o texto dentro do onclick continua dizendo
// "baralhoAtualId" — que não existe mais no JS minificado — e o clique quebra
// com "ReferenceError: baralhoAtualId is not defined"). Palavras dentro de
// aspas simples (ex: 'básico', '${chaveEscapada}') também acabam sendo
// capturadas por essa varredura mais ampla — não tem problema, só reserva uns
// nomes a mais do que o estritamente necessário, sem custo nenhum.
// Esses nomes viram a lista "reserved" do mangle — ficam com o nome
// original, protegidos. Todo o resto (variáveis locais, funções internas não
// referenciadas via HTML) É ofuscado de verdade (nomes viram a, b, c...).
//
// Rodado automaticamente antes de cada `npm start` (ver "prestart" no
// package.json) — não precisa rodar isso manualmente no dia a dia.

import { minify } from 'terser';
import { readFile, writeFile } from 'node:fs/promises';

const HANDLER_ATTR_REGEX = /on(?:click|change|input|load|mousedown|mouseup|keyup|focus)="([^"]*)"/g;
// Qualquer identificador solto (função OU variável) dentro do handler —
// exceto quando vem logo depois de um "." (acesso a propriedade, tipo
// "event.target", que não é um nome de topo do nosso JS e não precisa/deve
// ser reservado).
const IDENTIFICADOR_REGEX = /(?<!\.)\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g;

async function nomesReservados(arquivos) {
    const reservados = new Set();
    for (const caminho of arquivos) {
        const texto = await readFile(caminho, 'utf-8');
        let m;
        while ((m = HANDLER_ATTR_REGEX.exec(texto))) {
            const corpo = m[1];
            let c;
            while ((c = IDENTIFICADOR_REGEX.exec(corpo))) {
                reservados.add(c[0]);
            }
        }
    }
    return [...reservados];
}

async function minificar(entrada, saida, reservados) {
    const codigo = await readFile(entrada, 'utf-8');
    const resultado = await minify(codigo, {
        compress: true,
        mangle: { toplevel: true, reserved: reservados },
        format: { comments: false }
    });
    if (resultado.error) throw resultado.error;
    await writeFile(saida, resultado.code, 'utf-8');
    const kb = (Buffer.byteLength(resultado.code, 'utf-8') / 1024).toFixed(1);
    console.log(`  ✓ ${saida} (${kb} KB)`);
}

const reservados = await nomesReservados([
    'public/index.html',
    'public/jogo/index.html',
    'public/src/app.js',
    'public/jogo/src/index.js'
]);

console.log(`Build JS: ${reservados.length} nomes de função protegidos (usados em onclick/onchange/... no HTML).`);

await minificar('public/src/app.js', 'public/src/app.min.js', reservados);
await minificar('public/jogo/src/index.js', 'public/jogo/src/index.min.js', reservados);
