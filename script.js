
const API_URL = 'http://127.0.0.1:5000/execute';

// --- VARIÁVEIS DE CONTROLE DE EXECUÇÃO ---
let autoRunInterval = null;
const AUTO_RUN_DELAY = 900; // 0.5 segundos de espera entre passos

// --- ESTADO DA MÁQUINA ---
let machineState = {
    AX: 0x0000, BX: 0x0000, CX: 0x0000, DX: 0x0000,
    CS: 0x1000, SS: 0x2000, DS: 0x3000, ES: 0x4000,
    IP: 0x0100, SP: 0xFFFE, BP: 0x0000, DI: 0x0000, SI: 0x0010,
    FLAGS: 0x0002,
    memory: {}, // Estrutura: { '00000': { val: '00', desc: '...' } }
    instructions: [],
    currentInstructionIndex: 0,
    busStep: 1
};

// --- FUNÇÕES UTILITÁRIAS ---

function padHex(num, len = 4) { 
    return (num & 0xFFFF).toString(16).toUpperCase().padStart(len, '0'); 
}

/** Compara estado antigo e novo para piscar valores alterados */
function highlightChanges(oldState, newState) {
    const registers = [
        { id: 'reg-ax', key: 'AX' }, { id: 'reg-bx', key: 'BX' },
        { id: 'reg-cx', key: 'CX' }, { id: 'reg-dx', key: 'DX' },
        { id: 'reg-cs', key: 'CS' }, { id: 'reg-ss', key: 'SS' },
        { id: 'reg-ds', key: 'DS' }, { id: 'reg-es', key: 'ES' },
        { id: 'reg-ip', key: 'IP' }, { id: 'reg-sp', key: 'SP' },
        { id: 'reg-bp', key: 'BP' }, { id: 'reg-di', key: 'DI' },
        { id: 'reg-si', key: 'SI' }, { id: 'reg-flag-value', key: 'FLAGS' }
    ];

    registers.forEach(reg => {
        if (oldState[reg.key] !== newState[reg.key]) {
            const element = document.getElementById(reg.id);
            if (element) {
                element.classList.remove('blink');
                void element.offsetWidth; // Força reflow para reiniciar animação
                element.classList.add('blink');
            }
        }
    });
}

/** Atualiza toda a interface (Registradores e Memória) */
function updateUI() {
    // 1. Registradores
    document.getElementById('reg-ax').textContent = padHex(machineState.AX) + 'H';
    document.getElementById('reg-bx').textContent = padHex(machineState.BX) + 'H';
    document.getElementById('reg-cx').textContent = padHex(machineState.CX) + 'H';
    document.getElementById('reg-dx').textContent = padHex(machineState.DX) + 'H';
    
    document.getElementById('reg-cs').textContent = padHex(machineState.CS) + 'H';
    document.getElementById('reg-ss').textContent = padHex(machineState.SS) + 'H';
    document.getElementById('reg-ds').textContent = padHex(machineState.DS) + 'H';
    document.getElementById('reg-es').textContent = padHex(machineState.ES) + 'H';
    
    document.getElementById('reg-ip').textContent = padHex(machineState.IP) + 'H';
    document.getElementById('reg-sp').textContent = padHex(machineState.SP) + 'H';
    document.getElementById('reg-bp').textContent = padHex(machineState.BP) + 'H';
    document.getElementById('reg-di').textContent = padHex(machineState.DI) + 'H';
    document.getElementById('reg-si').textContent = padHex(machineState.SI) + 'H';

    document.getElementById('reg-flag-value').textContent = padHex(machineState.FLAGS) + 'H';
    
    // 2. Tabela de Memória (3 Colunas)
    const memoryContainer = document.getElementById('memory-view');
    const sortedAddresses = Object.keys(machineState.memory).sort((a, b) => parseInt(a, 16) - parseInt(b, 16));
    
    let tableHTML = `
        <table class="memory-table">
            <thead>
                <tr>
                    <th>Endereço (Físico)</th>
                    <th>Valor (Byte)</th>
                    <th>Instrução / Significado</th>
                </tr>
            </thead>
            <tbody>
    `;

    for (const addrHex of sortedAddresses) {
        const memData = machineState.memory[addrHex];
        // Suporte a legado (caso venha só valor) ou objeto completo
        const val = memData.val || memData; 
        const desc = memData.desc || '-';
        
        tableHTML += `
            <tr>
                <td style="font-weight: bold;">${addrHex}H</td>
                <td class="mem-val">${val}H</td>
                <td class="mem-desc">${desc}</td>
            </tr>
        `;
    }
    tableHTML += '</tbody></table>';
    memoryContainer.innerHTML = tableHTML;
}

/** Lê o código do textarea */
function loadCode() {
    const code = document.getElementById('assembly-code').value;
    // Filtra linhas vazias e comentários
    machineState.instructions = code.trim().split('\n')
        .map(line => line.trim().toUpperCase())
        .filter(line => line !== '' && !line.startsWith(';'));

    if (machineState.instructions.length === 0) {
        document.getElementById('status-message').textContent = 'Erro: Nenhum código válido encontrado.';
        return false;
    }
    
    machineState.currentInstructionIndex = 0;
    document.getElementById('status-message').textContent = `Código carregado. ${machineState.instructions.length} instruções prontas.`;
    return true;
}

/** Comunicação com o Python */
async function callBackend(instruction, state) {
    try {
        const dataToSend = {
            instruction: instruction,
            state: state,
            memory: state.memory,
            busStep: state.busStep 
        };

        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dataToSend)
        });

        const data = await response.json();

        if (response.ok) {
            return data;
        } else {
            console.error("Erro do servidor:", data.error);
            document.getElementById('status-message').textContent = `Erro na execução: ${data.error}`;
            return null;
        }

    } catch (error) {
        console.error("Erro de conexão:", error);
        document.getElementById('status-message').textContent = 'ERRO: Backend não respondeu.';
        stopAutoRun(); // Para automação se cair a conexão
        return null;
    }
}

// --- LÓGICA DE EXECUÇÃO AUTOMÁTICA ---

function toggleAutoRun() {
    const btn = document.getElementById('btn-autorun');

    // Se já estiver rodando, PARA
    if (autoRunInterval) {
        stopAutoRun();
        document.getElementById('status-message').textContent = 'Execução automática pausada.';
    } 
    // Se estiver parado, INICIA
    else {
        if (machineState.instructions.length === 0) {
            document.getElementById('status-message').textContent = 'Carregue o código primeiro!';
            return;
        }
        
        if (machineState.currentInstructionIndex >= machineState.instructions.length) {
            document.getElementById('status-message').textContent = 'O código já foi finalizado. Resete.';
            return;
        }

        // Atualiza UI do botão
        btn.textContent = "Parar Execução";
        btn.style.backgroundColor = "#da3633"; 
        btn.style.color = "white";
        
        // Executa o primeiro passo imediatamente
        simulateExecution('step');

        // Define o loop
        autoRunInterval = setInterval(async () => {
            // Verifica condição de parada antes de executar
            if (machineState.currentInstructionIndex >= machineState.instructions.length) {
                stopAutoRun();
                document.getElementById('status-message').textContent = 'Execução automática finalizada.';
                return;
            }
            await simulateExecution('step');
        }, AUTO_RUN_DELAY);
    }
}

function stopAutoRun() {
    if (autoRunInterval) {
        clearInterval(autoRunInterval);
        autoRunInterval = null;
    }
    const btn = document.getElementById('btn-autorun');
    if (btn) {
        btn.textContent = "Executar Tudo";
        btn.style.backgroundColor = "";
        btn.style.color = "";
    }
}

// --- FUNÇÃO PRINCIPAL DE CONTROLE ---

async function simulateExecution(action) {
    // 1. Inicialização (Carregar Código)
    if (action === 'init') {
        stopAutoRun(); // Garante que para se carregar novo código
        await simulateExecution('reset'); 
        if (loadCode()) {
            updateUI();
        }
        return;
    }

    // 2. Reset (Reiniciar Simulador)
    if (action === 'reset') {
        stopAutoRun(); // Garante que para se resetar
        
        const initial_state = {
            AX: 0, BX: 0, CX: 0, DX: 0, CS: 0x1000, SS: 0x2000, DS: 0x3000, ES: 0x4000,
            IP: 0x0100, SP: 0xFFFE, BP: 0, DI: 0, SI: 0x0010, FLAGS: 0x0002,
            memory: {}, instructions: [], currentInstructionIndex: 0, busStep: 1
        };
        
        const response = await callBackend('RESET', initial_state); 
        
        if (response) {
            Object.assign(machineState, response.newState);
            machineState.memory = response.memory;
            machineState.currentInstructionIndex = 0;
            machineState.instructions = [];
            machineState.busStep = response.busStep;
            
            document.getElementById('fluxo-output').textContent = 'Simulador resetado.';
            document.getElementById('address-calculation-output').textContent = '';
            document.getElementById('status-message').textContent = 'Reset concluído.';
            
            // Remove pisca-pisca antigo
            document.querySelectorAll('.blink').forEach(el => el.classList.remove('blink'));
            
            updateUI();
        }
        return;
    }

    // 3. Step (Executar uma Instrução)
    if (machineState.instructions.length === 0) {
        document.getElementById('status-message').textContent = 'Carregue o código primeiro.';
        stopAutoRun();
        return;
    }
    
    if (machineState.currentInstructionIndex >= machineState.instructions.length) {
        document.getElementById('status-message').textContent = 'Execução finalizada.';
        stopAutoRun();
        return;
    }
    
    const currentInstruction = machineState.instructions[machineState.currentInstructionIndex];
    
    // Chama Backend
    const response = await callBackend(currentInstruction, machineState);
    
    if (response) {
        // Efeito visual (Piscar mudanças)
        highlightChanges(machineState, response.newState);

        // Atualiza Estado Local
        Object.assign(machineState, response.newState);
        machineState.memory = response.memory;
        machineState.busStep = response.busStep;
        
        // Logs
        const fluxOutput = document.getElementById('fluxo-output');
        fluxOutput.textContent += `\n\n[${padHex(machineState.currentInstructionIndex, 2)}] ${currentInstruction}\n`;
        fluxOutput.textContent += response.busFlowLog;
        fluxOutput.scrollTop = fluxOutput.scrollHeight;

        document.getElementById('address-calculation-output').innerHTML = response.addressCalc;

        // Avança e Atualiza Tela
        machineState.currentInstructionIndex++;
        updateUI();

        // Mensagem
        if (machineState.currentInstructionIndex < machineState.instructions.length) {
             document.getElementById('status-message').textContent = `Instrução '${currentInstruction}' executada.`;
        } else {
             document.getElementById('status-message').textContent = 'Fim do programa.';
             stopAutoRun(); // Para automaticamente no fim
        }
    } else {
        stopAutoRun(); // Para se houver erro no backend
    }
}

// Inicializa UI ao carregar
document.addEventListener('DOMContentLoaded', () => {
    updateUI();
});