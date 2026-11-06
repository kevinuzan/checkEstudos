<#
  Atualiza as leis do app Direto à Posse a partir do SEU computador.

  Por quê: o Planalto bloqueia o IP do servidor do app ("Acesso Negado"), mas aceita o computador de
  casa. Então este script baixa as leis daqui e as envia ao app, que confere cada texto (mesma trava
  do "Enviar HTML"): se vier estranho, é recusado e o texto atual é mantido.

  Requisitos (feitos uma vez):
    1) Variável de ambiente do Windows LEIS_UPLOAD_KEY = a mesma chave configurada no Railway.
    2) (opcional) LEIS_APP_URL, se o endereço do app não for https://www.diretoaposse.com.br

  Uso:
    powershell -NoProfile -ExecutionPolicy Bypass -File .\atualizar-leis.ps1            (respeita o limite de 1x por dia)
    powershell -NoProfile -ExecutionPolicy Bypass -File .\atualizar-leis.ps1 -Forcar    (roda agora, mesmo já tendo rodado hoje)

  O resultado fica em %LOCALAPPDATA%\DiretoAPosse\leis-log.txt
#>
param([switch]$Forcar)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$App = if ($env:LEIS_APP_URL) { $env:LEIS_APP_URL.TrimEnd('/') } else { 'https://www.diretoaposse.com.br' }
$Chave = $env:LEIS_UPLOAD_KEY
$Pasta = Join-Path $env:LOCALAPPDATA 'DiretoAPosse'
New-Item -ItemType Directory -Force -Path $Pasta | Out-Null
$ArqUltima = Join-Path $Pasta 'leis-ultima-execucao.txt'
$ArqLog = Join-Path $Pasta 'leis-log.txt'
$log = New-Object System.Collections.ArrayList

function Registrar([string]$texto) {
    $linha = '{0:HH:mm:ss} {1}' -f (Get-Date), $texto
    [void]$log.Add($linha)
    Write-Host $linha
}
function Salvar-Log { Set-Content -Path $ArqLog -Value $log -Encoding UTF8 }

if (-not $Chave) {
    Registrar 'A variável LEIS_UPLOAD_KEY não está definida neste Windows. Veja o passo a passo no topo deste arquivo.'
    Salvar-Log
    exit 1
}

# Limite de 1 vez por dia: não adianta (e não é simpático) pedir ao Planalto toda hora.
if (-not $Forcar -and (Test-Path $ArqUltima)) {
    try {
        $ultima = [datetime]::Parse((Get-Content $ArqUltima -Raw).Trim(), [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind)
        if (((Get-Date) - $ultima).TotalHours -lt 24) {
            Write-Host 'Já rodou nas últimas 24 horas. Use -Forcar para rodar de novo.'
            exit 0
        }
    } catch { }
}

$cab = @{ 'x-leis-chave' = $Chave }

# O app informa quais leis existem e onde baixar: lei nova no app entra sem mexer neste script.
try {
    $catalogo = Invoke-RestMethod -Uri "$App/api/leis-importar/catalogo" -Headers $cab -TimeoutSec 60
} catch {
    Registrar "Não consegui falar com o app ($App): $($_.Exception.Message)"
    Salvar-Log
    exit 1
}

$problemaDeRede = $false
$atualizadas = 0; $iguais = 0; $recusadas = 0

foreach ($lei in $catalogo.leis) {
    $tmp = Join-Path $env:TEMP ('lei-' + $lei.id + '.htm')
    $baixou = $false
    for ($tentativa = 1; $tentativa -le 2 -and -not $baixou; $tentativa++) {
        try {
            # Sem User-Agent próprio: é o jeito que o Planalto aceitou na máquina do Kevin.
            Invoke-WebRequest -Uri $lei.url -UseBasicParsing -OutFile $tmp -TimeoutSec 90
            $baixou = $true
        } catch {
            if ($tentativa -lt 2) { Start-Sleep -Seconds 5 }
            else { Registrar "$($lei.nome): falha ao baixar do Planalto ($($_.Exception.Message))" }
        }
    }
    if (-not $baixou) { $problemaDeRede = $true; continue }

    try {
        # Bytes originais (o app decodifica os acentos do Planalto); em base64 pra viajar dentro de JSON.
        $bytes = [IO.File]::ReadAllBytes($tmp)
        $corpo = @{ htmlBase64 = [Convert]::ToBase64String($bytes) } | ConvertTo-Json -Compress
        $r = Invoke-RestMethod -Uri "$App/api/leis-importar/$($lei.id)" -Method Post -Headers $cab -ContentType 'application/json; charset=utf-8' -Body $corpo -TimeoutSec 180
        if ($r.ok) {
            if ($r.mudancas -gt 0) { $atualizadas++; Registrar "$($lei.nome): ATUALIZADA ($($r.mudancas) artigo(s) com mudança)" }
            else { $iguais++; Registrar "$($lei.nome): já estava igual" }
        } else {
            $recusadas++
            Registrar "$($lei.nome): RECUSADA pela verificação, texto atual mantido ($(@($r.motivos) -join '; '))"
        }
    } catch {
        $problemaDeRede = $true
        Registrar "$($lei.nome): erro ao enviar ao app ($($_.Exception.Message))"
    } finally {
        Remove-Item $tmp -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 3
}

Registrar "Resumo: $atualizadas atualizada(s), $iguais igual(is), $recusadas recusada(s)."
# Só marca "feito hoje" se não houve problema de rede/envio; senão tenta de novo no próximo gatilho.
if (-not $problemaDeRede) { Set-Content -Path $ArqUltima -Value (Get-Date).ToString('o') -Encoding ASCII }
Salvar-Log
if ($problemaDeRede) { exit 1 }
