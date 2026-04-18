// Estado para manter matérias minimizadas
let estadosMinimizados = JSON.parse(localStorage.getItem('editais_minimizados')) || {};

async function carregarEdital() {
    try {
        const res = await fetch('/api/edital');
        const dados = await res.json();
        renderizar(dados);
    } catch (err) {
        console.error("Erro ao carregar edital:", err);
    }
}

function renderizar(itens) {
    const lista = document.getElementById('lista-edital');
    lista.innerHTML = '';

    // Agrupar itens por matéria
    const grupos = itens.reduce((acc, item) => {
        acc[item.materia] = acc[item.materia] || [];
        acc[item.materia].push(item);
        return acc;
    }, {});

    // Progresso Geral para o Header do App
    let totalGeral = itens.length;
    let concluidosGeral = itens.filter(i => i.concluido).length;

    for (const materia in grupos) {
        const estaMinimizado = estadosMinimizados[materia] || false;
        const totalMat = grupos[materia].length;
        const concluidosMat = grupos[materia].filter(i => i.concluido).length;

        // CÁLCULO DA PORCENTAGEM DA MATÉRIA
        const percMat = totalMat > 0 ? Math.round((concluidosMat / totalMat) * 100) : 0;

        const divMateria = document.createElement('div');
        divMateria.className = 'materia-group';

        divMateria.innerHTML = `
            <div class="materia-header" onclick="toggleMateria('${materia}')" style="cursor:pointer; display:flex; justify-content:space-between; align-items:center;">
                <div class="materia-info">
                    <span class="seta">${estaMinimizado ? '▶' : '▼'}</span>
                    <strong class="materia-title">${materia}</strong>
                    <span class="stats-label">(${concluidosMat}/${totalMat}) - ${percMat}%</span>
                </div>
            </div>
            <div class="materia-content" style="display: ${estaMinimizado ? 'none' : 'block'}">
                ${grupos[materia].map(item => `
                    <div class="item-check ${item.concluido ? 'done' : ''}">
                        <input type="checkbox" ${item.concluido ? 'checked' : ''} 
                            onchange="toggleCheck('${item._id}', this.checked)">
                        <span class="topico-texto" onclick="editarTopico('${item._id}', '${item.topico}')">
                            ${item.topico}
                        </span>
                        <div class="actions">
                            <button class="btn-edit" onclick="editarTopico('${item._id}', '${item.topico}')">✎</button>
                            <button class="btn-delete" onclick="deletarTopico('${item._id}')">🗑️</button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
        lista.appendChild(divMateria);
    }

    // Atualiza a Barra de Progresso Principal (Geral)
    const percGeral = totalGeral > 0 ? (concluidosGeral / totalGeral * 100).toFixed(1) : 0;
    const progressFill = document.getElementById('progress-fill');
    if (progressFill) progressFill.style.width = `${percGeral}%`;

    const progressText = document.getElementById('progress-text');
    if (progressText) progressText.innerText = `${concluidosGeral}/${totalGeral} (${percGeral}%)`;
}

// --- FUNÇÕES DE INTERAÇÃO ---

async function toggleCheck(id, concluido) {
    await fetch(`/api/edital/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ concluido })
    });
    carregarEdital();
}

async function editarTopico(id, textoAtual) {
    const novoTexto = prompt("Editar tópico:", textoAtual);
    if (novoTexto && novoTexto !== "") {
        await fetch(`/api/edital/item/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ topico: novoTexto.trim() })
        });
        carregarEdital();
    }
}

async function deletarTopico(id) {
    if (confirm("Deseja excluir este tópico?")) {
        await fetch(`/api/edital/item/${id}`, { method: 'DELETE' });
        carregarEdital();
    }
}

function toggleMateria(materia) {
    estadosMinimizados[materia] = !estadosMinimizados[materia];
    localStorage.setItem('editais_minimizados', JSON.stringify(estadosMinimizados));
    carregarEdital();
}

async function importarEdital() {
    const materia = document.getElementById('materia-input').value;
    const textoBruto = document.getElementById('bulk-input').value;

    if (!materia || !textoBruto) return alert("Preencha a matéria e os tópicos!");

    await fetch('/api/edital/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ materia, textoBruto })
    });

    document.getElementById('materia-input').value = '';
    document.getElementById('bulk-input').value = '';
    carregarEdital();
}


document.addEventListener('DOMContentLoaded', carregarEdital);