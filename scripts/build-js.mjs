// Minifica/ofusca os arquivos JS do front-end (public/src/app.js e
// public/jogo/src/index.js) usando o terser, mas com um cuidado importante:
// muita coisa nesse projeto é HTML gerado dinamicamente (template strings)
// com atributos tipo onclick="nomeDaFuncao(...)" — se o terser renomear essas
// funções (mangle "toplevel"), os botões param de funcionar, porque o nome
// dentro da string HTML não é atualizado junto.
//
// Solução: antes de minificar, varremos os dois arquivos HTML E os dois
// arquivos JS-fonte atrás de qualquer on(click|change|input|load|mousedown|
// mouseup|keyup|focus)="..." e extraímos os nomes de função chamados lá
// dentro. Esses nomes viram a lista "reserved" do mangle — ficam com o nome
// original, protegidos. Todo o resto (variáveis locais, funções internas não
// referenciadas via HTML) É ofuscado de verdade (nomes viram a, b, c...).
//
// Rodado automaticamente antes de cada `npm start` (ver "prestart" no
// package.json) — não precisa rodar isso manualmente no dia a dia.

import { minify } from 'terser';
import { readFile, writeFile } from 'node:fs/promises';

const HANDLER_ATTR_REGEX = /on(?:click|change|input|load|mousedown|mouseup|keyup|focus)="([^"]*)"/g;
const CALL_REGEX = /([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g;

async function nomesReservados(arquivos) {
    const reservados = new Set();
    for (const caminho of arquivos) {
        const texto = await readFile(caminho, 'utf-8');
        let m;
        while ((m = HANDLER_ATTR_REGEX.exec(texto))) {
            const corpo = m[1];
            let c;
            while ((c = CALL_REGEX.exec(corpo))) {
                reservados.add(c[1]);
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
