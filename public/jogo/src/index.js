const termosJuridicosPorLetra = {
    A: ["Acórdão", "Advogado", "Ação", "Audiência", "Apelação", "Arbitragem", "Alienação", "Administrativa", "Ação popular", "Ação civil pública", "Alimentação", "Ampla proteção ao salário na falência da empresa", "Assiduidade", "Aptidão", "Avisos", "Aposentadoria", "Autoexecutoriedade", "Atos normativos", "Aquisição de materiais/produtos de marca específica", "Artista consagrado pela crítica ou pela opinião pública", "Apostilas"],
    B: ["Beneficiário", "Bens", "Bancarrota", "Busca e Apreensão", "Bonificação", "Branqueamento de Capital"],
    C: ["Contrato", "Constituição", "Competência", "Citação", "Caução", "Custas", "Coisa Julgada", "Competência", "Capacitação", "Condição mais benéfica", "Cidadania", "Consultor técnico ou instituição com notória especialização", "Circulares", "Certidões", "Contraditório", "Construir uma sociedade livre, justa e solidária", "Competência exclusiva"],
    D: ["Dano", "Defensor", "Denúncia", "Depósito", "Decreto", "Diligência", "Despacho", "Direitos individuais", "Despacho", "Demissão", "Desamparados", "Disciplina", "Dignidade da pessoa humana"],
    E: ["Embargo", "Escritura", "Estelionato", "Exceção", "Execução", "Extradição", "Embargo de Declaração", "Eficiência", "Exoneração", "Educação", "Estabilidade do salário", "Eficiência", "Erradicar a pobreza e a marginalização"],
    F: ["Fiança", "Foro", "Fraude", "Formalismo", "Fato Jurídico", "Favorecido", "Fiscalização", "Finalidade", "Forma", "Financeira", "Forma federativa de estado", "Finalidade", "Fornecedor exclusivo", "Falecimento"],
    G: ["Garantia", "Gratuidade de Justiça", "Guia", "Gestão", "Gravame", "Graduação", "Genealogia Jurídica", "Garantir o desenvolvimento nacional"],
    H: ["Habeas Corpus", "Honorários", "Hipoteca", "Homologação", "Hierarquia", "Herdabilidade", "Habilitação", "Habeas corpus", "Habeas data", "Higidez salarial"],
    I: ["Indenização", "Injunção", "Intimação", "Interesse", "Interdito", "Improbidade", "Imóvel", "In dubio pro operario", "Irrenunciabilidade dos direitos do trabalhador", "Imagem", "Infância", "Idoneidade moral", "Imperatividade", "Impessoalidade", "Instruções"],
    J: ["Jurisdição", "Juiz", "Julgamento", "Justiça", "Jurisprudência", "Juizado", "Jurada"],
    K: ["Kleptocracia", "Know-how", "Kangaroo Court (tribunal injusto)", "Kafkiano (relacionado a processos absurdos)"],
    L: ["Legislação", "Licitação", "Liminar", "Litispendência", "Lavagem de Dinheiro", "Leilão", "Liberdade Provisória", "Lugar", "Lazer", "Livre estipulação", "Legalidade", "Livre iniciativa"],
    M: ["Mandado", "Ministério Público", "Medida Cautelar", "Mora", "Moratória", "Mutirão", "Mesário", "Motivação", "Mandato Classista", "Mandado de segurança", "Mandado de injunção", "Marca", "Maternidade", "Moradia", "Monetização do salário", "Moralidade"],
    N: ["Notificação", "Nulidade", "Norma", "Necessidade", "Negócio Jurídico", "Nomeação", "Nexo Causal", "Norma mais favorável", "Nome"],
    O: ["Objeto", "Onerosidade", "Ordem Pública", "Obrigação", "Ofensa", "Outorga", "Observância", "Objeto", "Orçamentária", "Ofícios", "Objetividade", "Oralidade", "Ordens de Serviço"],
    P: ["Parecer", "Perícia", "Penhora", "Prescrição", "Prova", "Processo", "Pena", "Patrimonial", "Portarias", "Posse em cargo inacumulável", "Previdência", "Produtividade", "Publicidade", "Proporcionalidade", "Promoção", "Promover o bem de todos", "Presunção de legitimidade", "Periodicidade do pagamento", "Pareceres"],
    Q: ["Quota", "Questionamento", "Quórum", "Qualificação", "Quebra de Sigilo", "Quarentena"],
    R: ["Recurso", "Réu", "Réplicas", "Rescisão", "Remessa", "Representação", "Regulamento", "Recursos administrativos", "Readaptação", "Responsabilidade", "Razoabilidade"],
    S: ["Sentença", "Suspensão", "Súmula", "Sucessão", "Sigilo", "Sanção", "Subsídio", "Separação dos poderes", "Segredo", "Saúde", "Segurança", "Segurança jurídica", "Soberania nacional", "Salário é impenhorável", "Serviços técnicos de natureza singular"],
    T: ["Tutela", "Testamento", "Tribunal", "Transação", "Trânsito em Julgado", "Termo", "Tutela Antecipada", "Tratar de assuntos particulares", "Tempo", "Trabalho", "Transporte", "Transparência no pagamento", "Tipicidade"],
    U: ["Usucapião", "Urbanização", "Ultratividade", "Utilização", "Unificação", "Unilateralidade", "Urbanismo", "Ubiquidade"],
    V: ["Vara", "Vício", "Validade", "Veredicto", "Vínculo", "Vedação", "Violação", "Voto direto secreto", "Vedação ao salário inferior ao mínimo", "Valorização do trabalho humano"],
    W: ["Writ (ordem judicial)", "Wrongful Act", "Waiver (renúncia)", "Witness (testemunha)"],
    X: ["Xerox (cópia autenticada)", "Xenofobia (no direito penal)", "Exceção de Pré-Executividade", "Taxa de Execução"],
    Y: ["Yield (rendimento, rendimento jurídico)", "Yankee bond (título americano)", "Yearly tenancy (locação anual)", "Youth law (direito da juventude)"],
    Z: ["Zona de Interesse Jurídico", "Zelo", "Zona Franca", "Zeladoria", "Zelo Profissional", "Zona de Conflito"]
};

var competencias = [
    "Processar e julgar causas cíveis e criminais comuns de competência estadual.",
    "Julgar ações de direito de família e sucessões.",
    "Julgar ações penais comuns por crimes praticados dentro da jurisdição estadual.",
    "Organizar, dirigir e fiscalizar eleições em âmbito estadual e municipal.",
    "Julgar crimes eleitorais e infrações relacionadas ao processo eleitoral.",
    "Processar e julgar reclamações trabalhistas e dissídios coletivos.",
    "Julgar ações relativas à segurança e medicina do trabalho.",
    "Julgar ações de indenização por acidentes de trabalho.",
    "Processar e julgar crimes militares estaduais cometidos por policiais militares e bombeiros militares.",
    "Julgar infrações disciplinares militares estaduais.",
    "Julgar causas cíveis de menor complexidade em juizados especiais.",
    "Julgar infrações penais de menor potencial ofensivo em juizados especiais.",
    "Julgar causas relativas a direitos do consumidor em juizados especiais.",
    "Processar execuções fiscais estaduais e municipais.",
    "Julgar ações relativas a responsabilidade civil no âmbito estadual.",
    "Julgar pedidos de interdição e curatela.",
    "Processar ações de alimentos e tutela de menores.",
    "Julgar ações possessórias em âmbito estadual.",
    "Julgar questões relacionadas a propriedade e posse de bens imóveis estaduais.",
    "Julgar mandados de segurança contra atos de autoridades estaduais e municipais.",
    "Julgar ações de improbidade administrativa na esfera estadual.",
    "Julgar processos criminais por crimes ambientais estaduais.",
    "Julgar ações relativas a direito do consumidor em juizados especiais e varas cíveis estaduais.",
    "Julgar ações de desapropriação por interesse social ou utilidade pública estadual.",
    "Julgar recursos ordinários em processos cíveis estaduais.",
    "Julgar ações relativas a interesses coletivos e difusos em âmbito estadual.",
    "Julgar mandados de injunção em matérias estaduais.",
    "Processar e julgar ações de crime contra a ordem tributária estadual.",
    "Julgar ações civis públicas em defesa do meio ambiente estadual.",
    "Julgar ações de indenização por danos morais e materiais decorrentes de acidente de trânsito entre particulares, sem envolvimento da União, autarquias ou empresas públicas federais.",
    "Conhecer e julgar causas relativas à guarda, tutela, curatela e adoção de menores, inclusive quando houver disputa judicial entre os genitores ou familiares.",
    "Processar e julgar ações possessórias envolvendo imóveis rurais ou urbanos, quando não houver interesse de ente federal ou questão agrária de competência da Justiça Federal.",
    "Julgar ações de responsabilidade civil por erro médico ajuizadas por particulares contra hospitais privados ou profissionais de saúde autônomos.",
    "Conhecer e julgar execuções fiscais propostas por Estados ou Municípios para a cobrança de tributos como IPVA, ISS ou IPTU.",
    "Processar e julgar causas relacionadas a contratos de locação, compra e venda ou prestação de serviços entre pessoas físicas ou jurídicas no âmbito estadual.",
    "Julgar ações civis públicas propostas por associações civis em defesa de direitos coletivos locais, tais como saúde, educação ou transporte.",
    "Julgar ações contra decisões administrativas de órgãos estaduais, desde que não haja competência federal envolvida.",
    "Processar ações relativas à proteção do patrimônio histórico, cultural e ambiental estadual.",
    "Julgar ações de usucapião de imóveis localizados em áreas urbanas que não envolvam interesse de entes federais."
];


let allContainers = [];
let allContainers2 = [];
let currentIndex = 0;
let currentIndex2 = 0;

// Função para pegar as primeiras letras únicas da lista base
function getLetrasIniciais(palavras) {
    const letras = new Set();
    for (const palavra of palavras) {
        letras.add(palavra[0].toUpperCase());
    }
    return Array.from(letras);
}

// Função para escolher N palavras aleatórias de um array
function escolherAleatorias(array, n) {
    const copia = [...array];
    const escolhidas = [];
    for (let i = 0; i < n && copia.length > 0; i++) {
        const index = Math.floor(Math.random() * copia.length);
        escolhidas.push(copia.splice(index, 1)[0]);
    }
    return escolhidas;
}

// Função principal para criar a lista completa com palavras do minemônico e aleatórias
// function criarListaCompleta2(base, extras, numAleatorias = 2) {
//     const resultado = [...base];
//     const aleatorias = escolherAleatorias(extras, numAleatorias);
//     var enviar = []
//     for (const palavra of aleatorias) {
//         if (!resultado.includes(palavra)) {
//             enviar.push(palavra);
//         }
//     }

//     var contador = 0
//     for (var palavra2 in resultado) {
//         enviar.push(resultado[palavra2])
//         contador++
//         if (contador == 3) break

//     }

//     console.log(enviar)
//     return enviar;
// }


function criarListaCompleta2(base, extras, numAleatorias = 2) {
    const resultado = [...base];
    const aleatorias = escolherAleatorias(extras, numAleatorias);
    const enviar = [];

    // Adiciona as aleatórias que não estão no base
    for (const palavra of aleatorias) {
        if (!resultado.includes(palavra)) {
            enviar.push(palavra);
        }
    }

    // Preenche com mais aleatórias (diferentes) se não atingiu o número esperado
    while (enviar.length < numAleatorias) {
        const restantes = extras.filter(p => !resultado.includes(p) && !enviar.includes(p));
        if (restantes.length === 0) break;
        const extra = escolherAleatorias(restantes, 1)[0];
        enviar.push(extra);
    }

    // Adiciona até 3 da base
    for (let i = 0; i < resultado.length && enviar.length < numAleatorias + 3; i++) {
        enviar.push(resultado[i]);
    }

    console.log(enviar);
    return enviar;
}

// Função principal para criar a lista completa com palavras do minemônico e aleatórias
function criarListaCompleta(base, extras, numAleatorias = 2) {
    const letras = getLetrasIniciais(base);
    const resultado = [...base];

    for (const letra of letras) {
        if (extras[letra]) {
            const listaExtras = extras[letra];
            const aleatorias = escolherAleatorias(listaExtras, numAleatorias);

            for (const palavra of aleatorias) {
                if (!resultado.includes(palavra)) {
                    resultado.push(palavra);
                }
            }
        }
    }
    return resultado;
}

// Função para embaralhar um array
function shuffle2(array, qtd) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array.slice(0, qtd);
}

// Função para embaralhar um array
function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// Função para exibir um container específico e gerenciar a visibilidade dos botões de navegação
function displayContainer(index) {
    allContainers.forEach(container => {
        container.style.display = 'none'; // Esconde todos os containers
    });

    if (allContainers[index]) {
        allContainers[index].style.display = 'block'; // Exibe o container atual
    }

    const prevButton = document.getElementById('prevButton');
    const nextButton = document.getElementById('nextButton');

    if (prevButton) {
        prevButton.disabled = index === 0; // Desabilita 'Anterior' na primeira página
    }
    if (nextButton) {
        nextButton.disabled = index === allContainers.length - 1; // Desabilita 'Próximo' na última página
    }
}

// Função para avançar para o próximo container
function showNextContainer() {
    if (currentIndex < allContainers.length - 1) {
        currentIndex++;
        displayContainer(currentIndex);
    }
}

// Função para voltar para o container anterior
function showPrevContainer() {
    if (currentIndex > 0) {
        currentIndex--;
        displayContainer(currentIndex);
    }
}


// Função para exibir um container específico e gerenciar a visibilidade dos botões de navegação
function displayContainer2(index) {
    allContainers2.forEach(container => {
        container.style.display = 'none'; // Esconde todos os containers
    });

    if (allContainers2[index]) {
        allContainers2[index].style.display = 'block'; // Exibe o container atual
    }

    const prevButton = document.getElementById('prevButton2');
    const nextButton = document.getElementById('nextButton2');

    if (prevButton) {
        prevButton.disabled = index === 0; // Desabilita 'Anterior' na primeira página
    }
    if (nextButton) {
        nextButton.disabled = index === allContainers2.length - 1; // Desabilita 'Próximo' na última página
    }
}

// Função para avançar para o próximo container
function showNextContainer2() {
    if (currentIndex2 < allContainers2.length - 1) {
        currentIndex2++;
        displayContainer2(currentIndex2);
    }
}

// Função para voltar para o container anterior
function showPrevContainer2() {
    if (currentIndex2 > 0) {
        currentIndex2--;
        displayContainer2(currentIndex2);
    }
}


async function getItemData() {
    fetch('/jogo/json/productList.json')
        .then(response => response.json())
        .then(data => {
            const app = document.getElementById('mnemonicos');
            app.innerHTML = ''; // Limpa o conteúdo existente no 'app' div

            // Adiciona o título principal
            const titleRow = document.createElement('div');
            titleRow.className = 'row justify-content-center';
            titleRow.style.textAlign = 'center';
            // const mainTitle = document.createElement('h1');
            // mainTitle.className = 'text-center';
            // mainTitle.textContent = 'MINEMÔNICOS';
            // titleRow.appendChild(mainTitle);
            // Adiciona os botões de navegação ao final do app
            const navButtonsContainer = document.createElement('div');
            navButtonsContainer.className = 'd-flex justify-content-center mt-4';
            navButtonsContainer.innerHTML = `
                <button id="prevButton" class="btn btn-primary me-2"><i class="fas fa-arrow-left"></i></button>
                <button id="nextButton" class="btn btn-primary"><i class="fas fa-arrow-right"></i></button>
            `;
            app.appendChild(navButtonsContainer);
            app.appendChild(titleRow);
            app.appendChild(document.createElement('br')); // Adiciona uma quebra de linha


            data[0].items.forEach(item => {
                const container = document.createElement('div');
                container.className = 'container'; // Classe específica para os containers de minemônicos
                container.style.display = 'none'; // Esconde inicialmente

                // --- Adiciona a Matéria acima da Frase Inicial ---
                const materiaElement = document.createElement('h3'); // Usar h3 para a matéria
                materiaElement.className = 'materia-title text-center mb-2'; // Adicionar classes para estilo e espaçamento
                materiaElement.textContent = item.materia;
                container.appendChild(materiaElement);

                const header = document.createElement('div');
                header.className = 'header';
                // Lógica para destacar o minemônico na frase inicial
                let highlightedFrase = item.frase_inicial;
                if (item.minemonico && item.frase_inicial.includes(item.minemonico)) {
                    const styledMinemonico = `<span style="font-size: 1.2em; color: #28a745; font-weight: bold;">${item.minemonico}</span>`;
                    highlightedFrase = item.frase_inicial.replace(item.minemonico, styledMinemonico);
                }
                header.innerHTML = highlightedFrase; // Usa innerHTML para renderizar o span


                const cards = document.createElement('div');
                cards.className = 'cards';
                let listaPalavras = shuffle([...item.palavras_corretas]);
                var listaPalavras2 = [];
                let listaPalavrasFinal = criarListaCompleta(listaPalavras, termosJuridicosPorLetra);
                listaPalavrasFinal = shuffle([...listaPalavrasFinal]);
                var listaPalavras3 = ["11 jogadores - 11 membros",
                    "Jesus faleceu com 33 anos - 33 membros",
                    "30 sem (menos) 3 = 27 - 27 membros",
                    "SET - 7 membros",
                    "Viraram mocinha aos 15 anos - 15 membros"]
                const temInterseccao = listaPalavras.some(item1 =>
                    listaPalavras3.some(item2 => item1 === item2)
                );

                if (temInterseccao) {
                    switch (listaPalavras[0]) {
                        case '11 jogadores - 11 membros':
                            listaPalavras2 = ["22 jogadores - 22 membros",
                                "22 jogadores + Árbitro - 22 membros + Juíz",
                                "22 jogadores + Árbitro - 23 membros",
                                "11 jogadores + Técnico - 12 membros",
                                '11 jogadores - 11 membros'
                            ]
                            break;
                        case 'Jesus faleceu com 33 anos - 33 membros':
                            listaPalavras2 = ["Jesus assumiu o ministério com 30 anos - 30 membros",
                                "Ressureição de Jesus após 3 dias - 3 membros",
                                "Nascimento de Jesus 25 de Dezembro - 25 membros",
                                'Jesus faleceu com 33 anos - 33 membros'
                            ]
                            break;
                        case '30 sem (menos) 3 = 27 - 27 membros':
                            listaPalavras2 = ["30 sem 3 = 0 - 0 (não há membros)",
                                "30 dividido por 3 = 10 - 10 membros",
                                "30 sem (esqueceu do) 3 = 33 - 33 membros",
                                '30 sem (menos) 3 = 27 - 27 membros'
                            ]
                            break;
                        case 'SET - 7 membros':
                            listaPalavras2 = ["SETenta - 70 membros",
                                "dezesSETe - 17 membros",
                                "SETa do carro (4 setas) - 4 membros",
                                'SET - 7 membros'
                            ]
                            break;
                        case 'Viraram mocinha aos 15 anos - 15 membros':
                            listaPalavras2 = ["Início da menopausa 45 anos - 45 membros",
                                "Fim da puberdade 18 anos - 18 membros",
                                'Viraram mocinha aos 15 anos - 15 membros'
                            ]
                            break;
                    }
                    listaPalavrasFinal = listaPalavras2
                }

                listaPalavrasFinal.forEach(palavra => {
                    const card = document.createElement('div');
                    card.className = 'card';
                    card.textContent = palavra;
                    card.addEventListener('click', () => {
                        card.classList.toggle('active');
                    });
                    cards.appendChild(card);
                });

                const botaoFinal = document.createElement('button');
                botaoFinal.className = 'btn btn-success mt-3';
                botaoFinal.textContent = 'Enviar';
                botaoFinal.addEventListener('click', () => {
                    const selectedCards = container.querySelectorAll('.card.active');
                    const selectedTexts = Array.from(selectedCards).map(card => card.innerText.trim());

                    // Resetar estilos para todos os cards no container atual
                    const allCardsInContainer = container.querySelectorAll('.card');
                    allCardsInContainer.forEach(card => {
                        card.style.backgroundColor = '';
                        card.style.borderColor = '';
                        card.style.color = '';
                        card.style.fontWeight = '';
                    });

                    let allCorrectlySelected = true;
                    let allCorrectWordsPresent = true;

                    // Verificar cards selecionados para correção
                    selectedCards.forEach(card => {
                        const text = card.innerText.trim();
                        if (listaPalavras.includes(text)) {
                            card.style.backgroundColor = '#d4edda'; // Verde para correto
                            card.style.borderColor = '#28a745';
                            card.style.color = '#155724';
                            card.style.fontWeight = 'bold';
                        } else {
                            card.style.backgroundColor = '#f8d7da'; // Vermelho para incorreto
                            card.style.borderColor = '#dc3545';
                            card.style.color = '#721c24';
                            card.style.fontWeight = 'bold';
                            allCorrectlySelected = false; // Encontrou uma seleção incorreta
                        }
                    });

                    // Verificar se todas as palavras corretas originais foram selecionadas
                    for (const correctWord of listaPalavras) {
                        if (!selectedTexts.includes(correctWord)) {
                            allCorrectWordsPresent = false; // Uma palavra correta foi perdida
                            // Opcionalmente, destacar as palavras corretas perdidas de forma diferente
                            const missedCard = Array.from(allCardsInContainer).find(card => card.innerText.trim() === correctWord);
                            if (missedCard) {
                                missedCard.style.backgroundColor = '#ffeeba'; // Amarelo para correto, mas não selecionado
                                missedCard.style.borderColor = '#ffc107';
                                missedCard.style.color = '#856404';
                                missedCard.style.fontWeight = 'bold';
                            }
                        }
                    }

                    // Fornecer feedback com base nas verificações
                    if (selectedCards.length === 0) {
                        alert('Nenhum card selecionado!');
                    } else if (allCorrectlySelected && allCorrectWordsPresent && selectedTexts.length === listaPalavras.length) {
                        alert('Parabéns! Todas as palavras corretas foram selecionadas!');
                    } else {
                        alert('Verifique suas seleções. Há palavras incorretas selecionadas (vermelho) ou palavras corretas faltando (amarelo).');
                    }
                });

                const botaoReset = document.createElement('button');
                botaoReset.className = 'btn btn-secondary mt-3 ml-2';
                botaoReset.textContent = 'Reiniciar';
                botaoReset.addEventListener('click', () => {
                    const allCards = container.querySelectorAll('.card');
                    allCards.forEach(card => {
                        card.classList.remove('active');
                        card.style.backgroundColor = '';
                        card.style.borderColor = '';
                        card.style.color = '';
                        card.style.fontWeight = '';
                    });
                });

                container.appendChild(header);
                container.appendChild(cards);

                const botoesContainer = document.createElement('div');
                botoesContainer.className = 'botoes-container'; // ADICIONE ESTA CLASSE AQUI
                botoesContainer.style.gap = '10px'; // Pode remover este style inline se o CSS já cuidar do gap
                botoesContainer.style.marginTop = '10px'; // Pode remover este style inline se o CSS já cuidar do margin-top

                botoesContainer.appendChild(botaoReset);
                botoesContainer.appendChild(botaoFinal);

                container.appendChild(botoesContainer);
                allContainers.push(container); // Adiciona o container ao array global
                app.appendChild(container); // Adiciona o container ao DOM (mas estará oculto inicialmente)
            });

            // Adiciona event listeners aos botões de navegação
            document.getElementById('prevButton').addEventListener('click', showPrevContainer);
            document.getElementById('nextButton').addEventListener('click', showNextContainer);

            // Exibe o primeiro container
            displayContainer(currentIndex);
        })
        .catch(error => {
            console.error('Ocorreu um erro ao carregar o arquivo JSON:', error);
        });
}


async function getItemData2() {
    fetch('/jogo/json/competencias.json')
        .then(response => response.json())
        .then(data => {
            const app = document.getElementById('competencias');
            app.innerHTML = ''; // Limpa o conteúdo existente no 'app' div

            // Adiciona o título principal
            const titleRow = document.createElement('div');
            titleRow.className = 'row justify-content-center';
            titleRow.style.textAlign = 'center';
            // const mainTitle = document.createElement('h1');
            // mainTitle.className = 'text-center';
            // mainTitle.textContent = 'MINEMÔNICOS';
            // titleRow.appendChild(mainTitle);
            // Adiciona os botões de navegação ao final do app

            const atualiza = document.createElement('div');
            atualiza.className = 'd-flex right mt-4';
            atualiza.innerHTML = `
                <button id="update" class="btn btn-primary me-2"><i class="fas fa-rotate"></i></button>
            `;

            const navButtonsContainer = document.createElement('div');
            navButtonsContainer.className = 'd-flex justify-content-center mt-4';
            navButtonsContainer.innerHTML = `
                <button id="prevButton2" class="btn btn-primary me-2"><i class="fas fa-arrow-left"></i></button>
                <button id="nextButton2" class="btn btn-primary"><i class="fas fa-arrow-right"></i></button>
            `;
            app.appendChild(atualiza);
            app.appendChild(navButtonsContainer);
            app.appendChild(titleRow);
            app.appendChild(document.createElement('br')); // Adiciona uma quebra de linha


            Object.keys(data).forEach(key => {

                if (key === "GERAL") {
                    competencias = competencias.concat(data[key])
                } else {
                    const container = document.createElement('div');
                    container.className = 'container2'; // Classe específica para os containers de minemônicos
                    container.style.display = 'none'; // Esconde inicialmente

                    // --- Adiciona a Matéria acima da Frase Inicial ---
                    const materiaElement = document.createElement('h3'); // Usar h3 para a matéria
                    materiaElement.className = 'materia-title text-center mb-2'; // Adicionar classes para estilo e espaçamento
                    materiaElement.textContent = key;
                    container.appendChild(materiaElement);

                    const header = document.createElement('div');
                    header.className = 'header';
                    // Lógica para destacar o minemônico na frase inicial
                    let highlightedFrase = `Cabe ao(s) ${key}`;
                    header.innerHTML = highlightedFrase; // Usa innerHTML para renderizar o span
                    console.log(highlightedFrase)

                    const cards = document.createElement('div');
                    cards.className = 'cards2';
                    let listaPalavras = shuffle2([...data[key]], 1000);
                    let listaPalavrasFinal = criarListaCompleta2(listaPalavras, competencias);
                    console.log(listaPalavrasFinal)
                    listaPalavrasFinal = shuffle2([...listaPalavrasFinal], 5);

                    listaPalavrasFinal.forEach(palavra => {
                        const card = document.createElement('div');
                        card.className = 'card2';
                        card.textContent = palavra;
                        card.addEventListener('click', () => {
                            card.classList.toggle('active');
                        });
                        cards.appendChild(card);
                    });

                    const botaoFinal = document.createElement('button');
                    botaoFinal.className = 'btn btn-success mt-3';
                    botaoFinal.textContent = 'Enviar';
                    botaoFinal.addEventListener('click', () => {
                        const selectedCards = container.querySelectorAll('.card2.active');
                        const selectedTexts = Array.from(selectedCards).map(card => card.innerText.trim());


                        // Resetar estilos para todos os cards no container atual
                        const allCardsInContainer = container.querySelectorAll('.card2');
                        allCardsInContainer.forEach(card => {
                            card.style.backgroundColor = '';
                            card.style.borderColor = '';
                            card.style.color = '';
                            card.style.fontWeight = '';
                        });

                        let allCorrectlySelected = true;
                        let allCorrectWordsPresent = true;

                        // Verificar cards selecionados para correção
                        selectedCards.forEach(card => {
                            const text = card.innerText.trim();
                            console.log(text, allCorrectlySelected)
                            if (listaPalavras.includes(text)) {
                                card.style.backgroundColor = '#d4edda'; // Verde para correto
                                card.style.borderColor = '#28a745';
                                card.style.color = '#155724';
                                card.style.fontWeight = 'bold';
                            } else {
                                card.style.backgroundColor = '#f8d7da'; // Vermelho para incorreto
                                card.style.borderColor = '#dc3545';
                                card.style.color = '#721c24';
                                card.style.fontWeight = 'bold';
                                allCorrectlySelected = false; // Encontrou uma seleção incorreta
                            }
                        });

                        // Verificar se todas as palavras corretas originais foram selecionadas
                        for (const correctWord of listaPalavras) {
                            console.log(correctWord, selectedTexts)
                            if (!selectedTexts.includes(correctWord)) {
                                allCorrectWordsPresent = false; // Uma palavra correta foi perdida
                                // Opcionalmente, destacar as palavras corretas perdidas de forma diferente
                                const missedCard = Array.from(allCardsInContainer).find(card => card.innerText.trim() === correctWord);
                                if (missedCard) {
                                    missedCard.style.backgroundColor = '#ffeeba'; // Amarelo para correto, mas não selecionado
                                    missedCard.style.borderColor = '#ffc107';
                                    missedCard.style.color = '#856404';
                                    missedCard.style.fontWeight = 'bold';
                                }
                            }
                        }

                        // Fornecer feedback com base nas verificações
                        // if (selectedCards.length === 0) {
                        //     alert('Nenhum card selecionado!');
                        // } else if (allCorrectlySelected && allCorrectWordsPresent && selectedTexts.length === listaPalavras.length) {
                        //     alert('Parabéns! Todas as palavras corretas foram selecionadas!');
                        // } else {
                        //     alert('Verifique suas seleções. Há palavras incorretas selecionadas (vermelho) ou palavras corretas faltando (amarelo).');
                        // }
                    });

                    const botaoReset = document.createElement('button');
                    botaoReset.className = 'btn btn-secondary mt-3 ml-2';
                    botaoReset.textContent = 'Reiniciar';
                    botaoReset.addEventListener('click', () => {
                        const allCards = container.querySelectorAll('.card2');
                        allCards.forEach(card => {
                            card.classList.remove('active');
                            card.style.backgroundColor = '';
                            card.style.borderColor = '';
                            card.style.color = '';
                            card.style.fontWeight = '';
                        });
                    });

                    container.appendChild(header);
                    container.appendChild(cards);

                    const botoesContainer = document.createElement('div');
                    botoesContainer.className = 'botoes-container'; // ADICIONE ESTA CLASSE AQUI
                    botoesContainer.style.gap = '10px'; // Pode remover este style inline se o CSS já cuidar do gap
                    botoesContainer.style.marginTop = '10px'; // Pode remover este style inline se o CSS já cuidar do margin-top

                    botoesContainer.appendChild(botaoReset);
                    botoesContainer.appendChild(botaoFinal);

                    container.appendChild(botoesContainer);
                    allContainers2.push(container); // Adiciona o container ao array global
                    app.appendChild(container); // Adiciona o container ao DOM (mas estará oculto inicialmente)
                }
            });

            // Adiciona event listeners aos botões de navegação
            document.getElementById('prevButton2').addEventListener('click', showPrevContainer2);
            document.getElementById('nextButton2').addEventListener('click', showNextContainer2);
            document.getElementById('update').addEventListener('click', updateCards2);

            // Exibe o primeiro container
            displayContainer2(currentIndex2);
        })
        .catch(error => {
            console.error('Ocorreu um erro ao carregar o arquivo JSON:', error);
        });
}

function getContainerVisivel() {
    const containers = document.querySelectorAll('.container2');
    for (const container of containers) {
        const estilo = getComputedStyle(container);
        if (estilo.display === 'block') {
            return container;
        }
    }
    return null; // Nenhum visível
}

function updateCards2() {
    const containers = document.querySelectorAll('.container2');

    // Procura o que está com display: block
    let containerVisivel = null;
    for (const c of containers) {
        if (getComputedStyle(c).display === 'block') {
            containerVisivel = c;
            break;
        }
    }

    const cards2 = containerVisivel.querySelectorAll('.card2');
    if (containerVisivel) {
        cards2.forEach(card => card.remove());
    }
    const materia = containerVisivel.children[0].innerText
    console.log(materia)
    const cardsContainer = containerVisivel.querySelector('.cards2');
    fetch('/jogo/json/competencias.json')
        .then(response => response.json())
        .then(data => {
            let listaPalavras = shuffle2([...data[materia]], 1000);
            let listaPalavrasFinal = criarListaCompleta2(listaPalavras, competencias);
            console.log(listaPalavrasFinal)

            listaPalavrasFinal = shuffle2([...listaPalavrasFinal], 5);

            listaPalavrasFinal.forEach(palavra => {
                const card = document.createElement('div');
                card.className = 'card2';
                card.textContent = palavra;
                card.addEventListener('click', () => {
                    card.classList.toggle('active');
                });
                cardsContainer.appendChild(card);
            });
        });
}


// Função para remover acentos e pontuações, deixar só letras e números minúsculos
function normalizarTexto(texto) {
    return texto
        .normalize('NFD') // separa os acentos
        .replace(/[\u0300-\u036f]/g, '') // remove os acentos
        .replace(/[^\w\s]/gi, '') // remove pontuação
        .toLowerCase();
}

function gerarLacunasComInputs(texto, maxPalavras = 3) {
    const palavras = texto.split(/(\s+)/); // separa mantendo espaços

    // índices das palavras que são válidas para virar lacuna
    const indicesValidos = palavras
        .map((p, i) => ({ p, i }))
        .filter(({ p }) => /\b(?!Parágrafo)[\wçáéíóúâêôãõÁ-Ú]{7,}\b/i.test(p))
        .map(({ i }) => i);

    // Seleciona aleatoriamente os índices das palavras para ocultar
    const indicesParaOcultar = new Set();
    while (indicesParaOcultar.size < Math.min(maxPalavras, indicesValidos.length)) {
        const randIdx = indicesValidos[Math.floor(Math.random() * indicesValidos.length)];
        indicesParaOcultar.add(randIdx);
    }

    return palavras.map((p, i) => {
        if (indicesParaOcultar.has(i)) {
            return `<input type="text" class="lacuna-input form-control d-inline-block mx-1 my-1" style="width:auto; display:inline; padding:2px 6px;" data-resposta="${p.trim()}">`;
        }
        return p;
    }).join('');
}

async function carregarArtigosComLacunas() {
    const app = document.getElementById('lacunas');
    app.innerHTML = '';
    allContainers3 = [];
    currentIndex3 = 0;

    // Container dos botões topo (setas)
    const navButtonsContainer = document.createElement('div');
    navButtonsContainer.className = 'd-flex justify-content-center gap-2 mb-3';
    navButtonsContainer.innerHTML = `
        <button id="prevButton3" class="btn btn-primary"><i class="fas fa-arrow-left"></i></button>
        <button id="nextButton3" class="btn btn-primary"><i class="fas fa-arrow-right"></i></button>
    `;
    app.appendChild(navButtonsContainer);

    // Select do artigo
    const selectArtigos = document.createElement('select');
    selectArtigos.className = 'form-select mb-3';
    app.appendChild(selectArtigos);

    // Container do artigo
    const artigoContainer = document.createElement('div');
    app.appendChild(artigoContainer);

    const response = await fetch('/jogo/constituicao');
    const data = await response.json();
    const artigos = data.artigos;

    // Preenche select só com o número do Artigo (ex: "Art. 1º")
    artigos.forEach((artigo, index) => {
        const num = artigo.titulo.match(/^Art\. ?\d+º?/i);
        const texto = num ? num[0] : artigo.titulo; // pega só "Art. 5º", por ex
        const option = document.createElement('option');
        option.value = index;
        option.textContent = texto;
        selectArtigos.appendChild(option);
    });

    function mostrarArtigo(index) {
        artigoContainer.innerHTML = '';

        const artigo = artigos[index];

        // Mostra o título completo com lacunas
        const titulo = document.createElement('h4');
        titulo.innerHTML = gerarLacunasComInputs(artigo.titulo, 3);
        artigoContainer.appendChild(titulo);

        // Mostra os parágrafos
        artigo.paragrafos.forEach(p => {
            const pElem = document.createElement('p');
            pElem.innerHTML = gerarLacunasComInputs(p, 1);
            artigoContainer.appendChild(pElem);
        });

        // Botões corrigir e revelar
        const botoes = document.createElement('div');
        botoes.className = 'd-flex gap-2 mt-3';

        const botaoCorrigir = document.createElement('button');
        botaoCorrigir.className = 'btn btn-success';
        botaoCorrigir.textContent = 'Corrigir';
        botaoCorrigir.addEventListener('click', () => {
            const inputs = artigoContainer.querySelectorAll('input.lacuna-input');
            inputs.forEach(input => {
                const correto = normalizarTexto(input.dataset.resposta);
                const resposta = normalizarTexto(input.value);
                if (resposta === correto) {
                    input.style.backgroundColor = '#d4edda';
                    input.style.borderColor = '#28a745';
                } else {
                    input.style.backgroundColor = '#f8d7da';
                    input.style.borderColor = '#dc3545';
                }
            });
        });

        const botaoRevelar = document.createElement('button');
        botaoRevelar.className = 'btn btn-warning';
        botaoRevelar.textContent = 'Revelar';
        botaoRevelar.addEventListener('click', () => {
            const inputs = artigoContainer.querySelectorAll('input.lacuna-input');
            inputs.forEach(input => {
                input.value = input.dataset.resposta;
                input.style.backgroundColor = '#e2e3e5';
                input.style.borderColor = '#ced4da';
            });
        });

        botoes.appendChild(botaoCorrigir);
        botoes.appendChild(botaoRevelar);
        artigoContainer.appendChild(botoes);

        currentIndex3 = index;
        selectArtigos.value = index;
    }

    selectArtigos.addEventListener('change', () => {
        mostrarArtigo(parseInt(selectArtigos.value));
    });

    document.getElementById('prevButton3').addEventListener('click', () => {
        if (currentIndex3 > 0) mostrarArtigo(currentIndex3 - 1);
    });

    document.getElementById('nextButton3').addEventListener('click', () => {
        if (currentIndex3 < artigos.length - 1) mostrarArtigo(currentIndex3 + 1);
    });

    mostrarArtigo(currentIndex3);
}



let allContainers3 = [];
let currentIndex3 = 0;

function displayContainer3(index) {
    allContainers3.forEach(c => c.style.display = 'none');
    if (allContainers3[index]) allContainers3[index].style.display = 'block';
    document.getElementById('prevButton3').disabled = index === 0;
    document.getElementById('nextButton3').disabled = index === allContainers3.length - 1;
}

function showNextContainer3() {
    if (currentIndex3 < allContainers3.length - 1) {
        currentIndex3++;
        displayContainer3(currentIndex3);
    }
}

function showPrevContainer3() {
    if (currentIndex3 > 0) {
        currentIndex3--;
        displayContainer3(currentIndex3);
    }
}
