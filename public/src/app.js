async function carregarEdital() {
    const res = await fetch('/api/edital');
    const dados = await res.json();
    renderizar(dados);
}

function renderizar(itens) {
    const lista = document.getElementById('lista-edital');
    lista.innerHTML = '';

    // Agrupar por matéria
    const grupos = itens.reduce((acc, item) => {
        acc[item.materia] = acc[item.materia] || [];
        acc[item.materia].push(item);
        return acc;
    }, {});

    let total = itens.length;
    let concluidos = itens.filter(i => i.concluido).length;

    for (const materia in grupos) {
        const divMateria = document.createElement('div');
        divMateria.className = 'materia-group';
        divMateria.innerHTML = `<span class="materia-title">${materia}</span>`;

        grupos[materia].forEach(item => {
            const divItem = document.createElement('div');
            divItem.className = `item-check ${item.concluido ? 'done' : ''}`;
            divItem.innerHTML = `
                <input type="checkbox" ${item.concluido ? 'checked' : ''} 
                    onchange="toggleCheck('${item._id}', this.checked)">
                <span>${item.topico}</span>
            `;
            divMateria.appendChild(divItem);
        });
        lista.appendChild(divMateria);
    }

    // Atualiza Progresso
    const perc = total > 0 ? (concluidos / total * 100).toFixed(1) : 0;
    document.getElementById('progress-fill').style.width = `${perc}%`;
    document.getElementById('progress-text').innerText = `${concluidos}/${total} (${perc}%)`;
}

async function toggleCheck(id, concluido) {
    await fetch(`/api/edital/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ concluido })
    });
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

    document.getElementById('bulk-input').value = '';
    carregarEdital();
}

carregarEdital();