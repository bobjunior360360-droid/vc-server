#!/usr/bin/env node
// vc-pt-proxy: camada em português na frente do `vectorcraft-cli mcp`.
// Sem dependências. Fala JSON-RPC (uma mensagem por linha) com o cliente (stdin/stdout)
// e com o vectorcraft-cli (processo filho). Tudo que não é nosso passa direto.
//
// Acrescenta:
//   - instruções em português na resposta de "initialize"
//   - prompts em português (aparecem no botão do conector, junto com os originais)
//   - ferramentas: vc_paleta, vc_tamanhos, vc_contraste, vc_exportar
import { spawn } from 'node:child_process';
import readline from 'node:readline';

const CMD = process.env.VC_CMD || 'vectorcraft-cli';
const ARGS = (process.env.VC_ARGS ||
  'mcp --headless --automation-read-root /work --automation-write-root /work/out')
  .split(' ').filter(Boolean);

const child = spawn(CMD, ARGS, { stdio: ['pipe', 'pipe', 'inherit'] });
child.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => child.kill(sig));

// ---------------------------------------------------------------- utilidades
const toClient = (m) => process.stdout.write(JSON.stringify(m) + '\n');
const toChild = (m) => child.stdin.write((typeof m === 'string' ? m : JSON.stringify(m)) + '\n');
const ok = (id, result) => toClient({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => toClient({ jsonrpc: '2.0', id, error: { code, message } });
const text = (t, extra = {}) => ({ content: [{ type: 'text', text: t }], ...extra });

const internal = new Map(); // id interno -> resolve
let internalSeq = 0;
function callChild(method, params, timeoutMs = 120000) {
  const id = `vcpt-${++internalSeq}`;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { internal.delete(id); reject(new Error('tempo esgotado no VectorCraft')); }, timeoutMs);
    internal.set(id, (msg) => { clearTimeout(t); resolve(msg); });
    toChild({ jsonrpc: '2.0', id, method, params });
  });
}

// ---------------------------------------------------------------- instruções
const INSTRUCOES = [
  'IDIOMA: responda ao usuário sempre em português do Brasil, mesmo que os nomes das ferramentas e dos comandos estejam em inglês. O usuário pode descrever o pedido em português, de forma livre; não exija prompt em inglês.',
  'BRIEFING: se o pedido for vago (sem estilo, paleta ou formato), faça no máximo uma rodada curta de perguntas com opções (estilo, paleta, formato). Se o usuário já deu o suficiente, assuma o resto, diga o que assumiu em uma linha e desenhe.',
  'ANTES DE DESENHAR: use vc_tamanhos para o formato certo, vc_paleta para uma paleta harmônica e vc_contraste para conferir se o texto é legível sobre o fundo.',
  'MÉTODO: planeje, construa tudo em um command_batch atômico (do fundo para a frente), tire um screenshot, aponte defeitos concretos, corrija e confira de novo. Sempre passe fill e stroke explícitos e dê nome aos objetos.',
  'ENTREGA: o servidor é remoto, então arquivos salvos nele não chegam ao usuário. Para entregar, chame vc_exportar com formato "svg" (devolve o código SVG) e, se tiver ferramenta de arquivos, salve esse texto como .svg e apresente o arquivo; senão, mostre o SVG em um bloco de código. Formato "png" devolve uma imagem.',
  'LIMITE: o servidor não enxerga arquivos do celular do usuário. Não prometa vetorizar uma foto enviada; se ela for essencial, explique a limitação.',
].join('\n');

// ---------------------------------------------------------------- prompts em português
const BASE = [
  'Você controla o VectorCraft pelas ferramentas MCP. Responda ao usuário sempre em português do Brasil.',
  'Método: (1) planeje em 3 a 5 linhas: tamanho da prancheta, paleta, hierarquia e tipografia; (2) construa tudo em UM command_batch com atomic:true, do fundo para a frente, sempre com fill e stroke explícitos ("stroke":"none" em formas preenchidas) e name nos objetos importantes; (3) faça um screenshot, aponte defeitos concretos (contraste, alinhamento, vazios, texto cortado), corrija e confira de novo; (4) entregue com vc_exportar.',
  'Técnico: coordenadas em pontos, y cresce para baixo, origem no canto superior esquerdo da prancheta; opacity em draw_shape/draw_path vai de 0 a 100; degradê = fill:{"gradient":{"kind":"linear","stops":[{"offset":0,"color":"#..."},{"offset":1,"color":"#..."}],"start":[x,y],"end":[x,y]}}; dentro de command_batch o texto é text.create (add_text é ferramenta, não comando); use "$last.id" para citar o passo anterior; efeitos ao vivo com apply_effect (sem o parâmetro "effect" ele lista o catálogo); mantenha tudo editável, sem rasterizar. Se um parâmetro for recusado, leia a sugestão do erro e corrija a chave.',
  'Use vc_paleta, vc_tamanhos e vc_contraste quando ajudarem. Escreva textos reais em português, nunca lorem ipsum.',
].join('\n');

const val = (a, k, d) => (a && a[k] != null && String(a[k]).trim() !== '' ? String(a[k]).trim() : d);

const PROMPTS = [
  {
    name: 'cartaz', title: 'Cartaz', description: 'Cartaz ilustrado completo, com fundo, formas, texto e acabamento.',
    arguments: [
      { name: 'ideia', description: 'O que o cartaz mostra (ex.: pôr do sol em montanhas)', required: true },
      { name: 'paleta', description: 'Cores desejadas (opcional)' },
      { name: 'texto', description: 'Título e subtítulo (opcional)' },
      { name: 'formato', description: 'Tamanho, ex.: 600x800 (padrão)' },
    ],
    build: (a) => [BASE, '',
      'TAREFA: criar um cartaz.', 'Ideia: ' + val(a, 'ideia', 'livre'),
      'Paleta: ' + val(a, 'paleta', 'escolha 3 a 5 cores harmônicas e deixe uma dominar'),
      'Texto: ' + val(a, 'texto', 'escreva um título forte e uma linha de apoio coerentes com a ideia'),
      'Formato: ' + val(a, 'formato', '600x800') + ' (file.new com largura e altura).',
      'Camadas: fundo com degradê de 2 a 4 paradas; grandes massas (montanhas, prédios, ondas) com saturação decrescente para dar profundidade; elemento focal (sol, lua, personagem); detalhes e brilhos com degradê radial de baixa opacidade; texto por último, com margem de 6 a 8% do lado menor; efeito ao vivo só se ajudar (sombra suave no título).',
      'Confira o contraste do título com vc_contraste. Depois do screenshot, corrija e exporte.'].join('\n'),
  },
  {
    name: 'logo', title: 'Logo', description: 'Logotipo com símbolo e nome, mais versões em uma cor e em fundo escuro.',
    arguments: [
      { name: 'nome', description: 'Nome da marca', required: true },
      { name: 'segmento', description: 'O que a marca faz (ex.: café, tecnologia, barbearia)' },
      { name: 'estilo', description: 'minimalista, geométrico, moderno, retrô, orgânico, tipográfico (padrão: minimalista)' },
      { name: 'cores', description: 'Cores desejadas (opcional)' },
    ],
    build: (a) => [BASE, '',
      'TAREFA: criar um logotipo.', 'Nome: ' + val(a, 'nome', 'Marca'),
      'Segmento: ' + val(a, 'segmento', 'não informado; escolha um símbolo neutro e memorável'),
      'Estilo: ' + val(a, 'estilo', 'minimalista'), 'Cores: ' + val(a, 'cores', 'no máximo 2 cores mais neutro; uma cor de destaque'),
      'Regras de qualidade: símbolo simples que funcione em 32 px; formas geométricas vivas (ellipse, polygon, star, path) combinadas com pathfinder quando precisar de silhueta única; mesma espessura de traço em todo o símbolo; nome em text.create com tamanho que equilibre com o símbolo e espaçamento igual ao redor; nada de efeitos que não sobrevivam a uma cor só.',
      'Prancheta de 1800x600: versão principal à esquerda; copie (transform com copy:true) para uma versão em uma cor (preto) no centro e uma versão clara sobre retângulo escuro à direita. Nomeie: "Principal", "Mono", "Invertida".',
      'Confira o contraste da versão invertida com vc_contraste e exporte o SVG.'].join('\n'),
  },
  {
    name: 'icones', title: 'Conjunto de ícones', description: 'Conjunto de ícones coerentes em grade.',
    arguments: [
      { name: 'assunto', description: 'O que os ícones representam (ex.: clima, finanças)', required: true },
      { name: 'quantidade', description: 'Quantos ícones (padrão 9)' },
      { name: 'estilo', description: 'contorno, silhueta ou duas-cores (padrão: contorno)' },
      { name: 'cor', description: 'Cor principal (opcional)' },
    ],
    build: (a) => [BASE, '',
      'TAREFA: criar um conjunto de ícones.', 'Assunto: ' + val(a, 'assunto', 'geral'),
      'Quantidade: ' + val(a, 'quantidade', '9'), 'Estilo: ' + val(a, 'estilo', 'contorno'), 'Cor: ' + val(a, 'cor', '#1F2937 com um acento'),
      'Defina antes e use igual em todos: célula 64x64, intervalo de 16, espessura de traço 2 (cap e join round), raio de canto 4, preenchimento interno de 8. Grade de 3 colunas, na ordem de leitura. Cada ícone em um grupo nomeado ("icone-<nome>").',
      'Todos devem ter o mesmo peso visual e a mesma linha de base. Aplique a mesma pintura ao conjunto e use um único acento só onde ajudar. Revise como conjunto, corrija inconsistências (não adicione detalhe) e exporte o SVG.'].join('\n'),
  },
  {
    name: 'post-social', title: 'Post para redes sociais', description: 'Post, story, capa ou banner no tamanho certo da rede.',
    arguments: [
      { name: 'tema', description: 'Assunto do post', required: true },
      { name: 'formato', description: 'feed 1080x1080, retrato 1080x1350, story 1080x1920, capa-youtube 1280x720, banner-x 1500x500 (padrão: feed)' },
      { name: 'texto', description: 'Texto principal (opcional)' },
      { name: 'paleta', description: 'Cores (opcional)' },
    ],
    build: (a) => [BASE, '',
      'TAREFA: criar uma peça para redes sociais.', 'Tema: ' + val(a, 'tema', 'livre'),
      'Formato: ' + val(a, 'formato', 'feed 1080x1080') + ' (consulte vc_tamanhos se não souber as medidas).',
      'Texto: ' + val(a, 'texto', 'frase curta e direta sobre o tema, no máximo 8 palavras'),
      'Paleta: ' + val(a, 'paleta', 'vibrante com alto contraste'),
      'Regras: uma ideia só e um ponto focal; texto grande (título a partir de 8% da altura) dentro da zona segura (nada a menos de 6% das bordas; em story deixe 14% livres em cima e embaixo); contraste do texto conferido com vc_contraste; fundo com degradê ou formas grandes, nunca vazio.'].join('\n'),
  },
  {
    name: 'cartao-visita', title: 'Cartão de visita', description: 'Cartão de visita frente e verso, 90x50 mm.',
    arguments: [
      { name: 'nome', description: 'Nome da pessoa', required: true },
      { name: 'cargo', description: 'Cargo ou profissão' },
      { name: 'contato', description: 'Telefone, e-mail, site, endereço' },
      { name: 'estilo', description: 'sóbrio, criativo, luxo, tecnológico (padrão: sóbrio)' },
    ],
    build: (a) => [BASE, '',
      'TAREFA: criar um cartão de visita (frente e verso).', 'Nome: ' + val(a, 'nome', 'Nome Sobrenome'),
      'Cargo: ' + val(a, 'cargo', 'Profissional'), 'Contato: ' + val(a, 'contato', 'telefone, e-mail e site fictícios mas plausíveis'), 'Estilo: ' + val(a, 'estilo', 'sóbrio'),
      'Medida: 90x50 mm = 255x142 pt. Crie duas pranchetas lado a lado (frente e verso) ou uma prancheta de 540x142 com as duas faces e uma folga de 30 pt. Mantenha margem de segurança de 12 pt; texto mínimo de 7 pt. Frente: marca/nome em destaque. Verso: contatos alinhados à esquerda, hierarquia clara, um acento de cor.'].join('\n'),
  },
  {
    name: 'adesivos', title: 'Pacote de adesivos', description: 'Adesivos com contorno branco, prontos para cortar.',
    arguments: [
      { name: 'tema', description: 'Tema (ex.: gatos, café, viagem)', required: true },
      { name: 'quantidade', description: 'Quantidade (padrão 6)' },
      { name: 'estilo', description: 'fofo, chapado, contorno-grosso (padrão: fofo)' },
    ],
    build: (a) => [BASE, '',
      'TAREFA: criar um pacote de adesivos.', 'Tema: ' + val(a, 'tema', 'livre'), 'Quantidade: ' + val(a, 'quantidade', '6'), 'Estilo: ' + val(a, 'estilo', 'fofo'),
      'Cada adesivo cabe em 240x240, com grade de 3 colunas. Formas simples com contorno escuro uniforme de 3; cores chapadas ou degradês suaves; brilho/sombra pequenos em tom mais claro/escuro. Contorno de corte: duplique a silhueta (pathfinder unite), aumente o traço para 14 em branco e coloque atrás do desenho, nomeando "corte". Fundo da prancheta de uma cor suave para destacar o branco.'].join('\n'),
  },
  {
    name: 'avatar', title: 'Avatar', description: 'Avatar ou foto de perfil ilustrada.',
    arguments: [
      { name: 'descricao', description: 'Quem ou o que é (ex.: mulher de óculos e cabelo cacheado)', required: true },
      { name: 'estilo', description: 'plano, geométrico, fofo, retrô (padrão: plano)' },
      { name: 'fundo', description: 'Cor ou clima do fundo (opcional)' },
    ],
    build: (a) => [BASE, '',
      'TAREFA: criar um avatar.', 'Descrição: ' + val(a, 'descricao', 'pessoa genérica'), 'Estilo: ' + val(a, 'estilo', 'plano'), 'Fundo: ' + val(a, 'fundo', 'cor lisa ou degradê suave'),
      'Prancheta 1024x1024, personagem centrado, ombros cortados pela borda. Sem contornos desnecessários: use 3 tons por área (base, sombra, luz) em formas sobrepostas; olhos, nariz e boca simples; cabelo com silhueta marcante. Fundo circular opcional atrás para funcionar como foto de perfil redonda.'].join('\n'),
  },
  {
    name: 'padrao', title: 'Padrão contínuo', description: 'Estampa que se repete sem emendas.',
    arguments: [
      { name: 'motivo', description: 'Elementos da estampa (ex.: folhas e flores)', required: true },
      { name: 'cores', description: 'Cores (opcional)' },
      { name: 'ladrilho', description: 'Tamanho do quadrado de repetição (padrão 400)' },
    ],
    build: (a) => [BASE, '',
      'TAREFA: criar um padrão contínuo (estampa).', 'Motivo: ' + val(a, 'motivo', 'formas orgânicas'), 'Cores: ' + val(a, 'cores', '4 cores harmônicas'), 'Ladrilho: ' + val(a, 'ladrilho', '400') + ' pt (quadrado).',
      'Prancheta = ladrilho. Fundo liso. Distribua os elementos com ritmo irregular, evitando linhas visíveis. Todo elemento que cruza uma borda deve ser copiado com transform (copy:true) deslocado de ±largura (ou ±altura) para a borda oposta, para a emenda ficar invisível. Mostre o resultado repetido em 3x3 copiando o ladrilho para conferir a emenda, depois desfaça a conferência (ou use outra prancheta) e entregue o ladrilho único.'].join('\n'),
  },
  {
    name: 'papel-de-parede', title: 'Papel de parede', description: 'Papel de parede para celular ou computador.',
    arguments: [
      { name: 'tema', description: 'Tema ou clima (ex.: noite estrelada, montanhas)', required: true },
      { name: 'dispositivo', description: 'celular 1080x2400, desktop 1920x1080 ou 4k 3840x2160 (padrão: celular)' },
      { name: 'paleta', description: 'Cores (opcional)' },
    ],
    build: (a) => [BASE, '',
      'TAREFA: criar um papel de parede.', 'Tema: ' + val(a, 'tema', 'abstrato'), 'Dispositivo: ' + val(a, 'dispositivo', 'celular 1080x2400'), 'Paleta: ' + val(a, 'paleta', 'harmônica, de baixo contraste para os ícones ficarem legíveis'),
      'Sem texto. Composição em camadas (fundo em degradê, formas grandes suaves, detalhes pequenos). Em celular deixe o terço superior e a faixa inferior mais calmos (relógio e dock). Use degradês com dither:true para evitar faixas.'].join('\n'),
  },
  {
    name: 'mascote', title: 'Mascote', description: 'Personagem mascote em formas vetoriais.',
    arguments: [
      { name: 'descricao', description: 'Quem é o mascote (ex.: raposa astronauta)', required: true },
      { name: 'estilo', description: 'fofo, esportivo, retrô, geométrico (padrão: fofo)' },
      { name: 'cores', description: 'Cores (opcional)' },
    ],
    build: (a) => [BASE, '',
      'TAREFA: criar um mascote.', 'Descrição: ' + val(a, 'descricao', 'animal simpático'), 'Estilo: ' + val(a, 'estilo', 'fofo'), 'Cores: ' + val(a, 'cores', '3 a 4 cores mais um tom escuro para contorno'),
      'Prancheta 1000x1000. Construa em grupos nomeados (corpo, cabeça, rosto, acessórios, sombra). Contorno escuro de espessura uniforme (6), cantos arredondados, formas grandes primeiro. Rosto expressivo com poucos elementos; luz de um lado só. Sombra de chão como elipse suave com opacidade baixa.'].join('\n'),
  },
  {
    name: 'infografico', title: 'Infográfico', description: 'Infográfico ou gráfico com os dados do usuário.',
    arguments: [
      { name: 'dados', description: 'Dados e assunto (ex.: vendas por trimestre: T1 10, T2 18...)', required: true },
      { name: 'tipo', description: 'barras, pizza, linha, linha-do-tempo (padrão: o mais adequado)' },
      { name: 'paleta', description: 'Cores (opcional)' },
    ],
    build: (a) => [BASE, '',
      'TAREFA: criar um infográfico.', 'Dados: ' + val(a, 'dados', 'peça os dados ao usuário'), 'Tipo: ' + val(a, 'tipo', 'escolha o mais adequado'), 'Paleta: ' + val(a, 'paleta', 'sóbria, com uma cor de destaque para o dado principal'),
      'Gráficos de barras, pizza, linha e dispersão: use a ferramenta create_graph com os dados reais (csv). Depois estilize com paint. Linha do tempo: construa com formas. Inclua título, subtítulo e fonte; destaque o dado principal com a cor de acento e deixe o resto neutro; rótulos legíveis (mínimo 12 pt na prancheta 800x1000 ou 1080 de largura). Nunca invente números além dos fornecidos; se faltar algo, diga.'].join('\n'),
  },
  {
    name: 'recolorir', title: 'Recolorir', description: 'Troca a paleta do documento aberto.',
    arguments: [
      { name: 'paleta', description: 'Nova paleta ou clima (ex.: tons de oceano)', required: true },
      { name: 'metodo', description: 'preservar-tons (padrão), exato, deslocar-matiz' },
    ],
    build: (a) => [BASE, '',
      'TAREFA: recolorir o documento aberto.', 'Nova paleta: ' + val(a, 'paleta', 'harmônica'), 'Método: ' + val(a, 'metodo', 'preservar-tons'),
      'Passos: inspect_document; recolor.colors para listar as cores em uso; monte o mapa de/para mantendo a hierarquia (fundo continua mais escuro ou mais claro que o primeiro plano; o acento continua sendo o mais saturado); recolor.apply com o método (preserveTints, exact ou hueShift); confira texto com vc_contraste; screenshot e ajuste.'].join('\n'),
  },
  {
    name: 'revisar', title: 'Revisar e melhorar', description: 'Critica o documento aberto e corrige os problemas.',
    arguments: [{ name: 'foco', description: 'O que melhorar (ex.: legibilidade, equilíbrio); opcional' }],
    build: (a) => [BASE, '',
      'TAREFA: revisar o documento aberto e melhorá-lo.', 'Foco: ' + val(a, 'foco', 'qualidade geral'),
      'Passos: inspect_document (depth 1) e screenshot; liste de 3 a 6 problemas concretos e verificáveis (contraste com vc_contraste, alinhamento, margens, hierarquia, peso visual, texto cortado, objetos sem nome); corrija um por um com comandos pequenos; faça novo screenshot e confirme cada correção. Não refaça o que já está bom.'].join('\n'),
  },
  {
    name: 'variacoes', title: 'Variações de cor', description: 'Gera versões do documento aberto em outras paletas.',
    arguments: [
      { name: 'quantidade', description: 'Quantas variações (padrão 3)' },
      { name: 'ideias', description: 'Climas desejados (ex.: escuro, pastel, neon); opcional' },
    ],
    build: (a) => [BASE, '',
      'TAREFA: criar variações de cor do documento aberto.', 'Quantidade: ' + val(a, 'quantidade', '3'), 'Climas: ' + val(a, 'ideias', 'escolha variações bem distintas (clara, escura, vibrante)'),
      'Passos: leia as cores com recolor.colors; para cada variação, selecione tudo, duplique o conjunto (transform copy:true com dx igual à largura mais 40), e aplique recolor.apply só na cópia; use vc_paleta para as paletas; confira texto com vc_contraste em cada uma; um screenshot geral no fim.'].join('\n'),
  },
];

// ---------------------------------------------------------------- ferramentas locais
const hexRe = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i;
function normHex(h) {
  const m = String(h || '').trim().match(hexRe);
  if (!m) return null;
  let s = m[1].toLowerCase();
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  return '#' + s;
}
const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function rgbToHex([r, g, b]) { return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join(''); }
function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b); let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min; s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0); else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}
function hslToRgb([h, s, l]) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0]; else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c]; else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
function luminance(hex) {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const [r, g, b] = hexToRgb(hex); return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a, b) { const la = luminance(a), lb = luminance(b); const [hi, lo] = la > lb ? [la, lb] : [lb, la]; return (hi + 0.05) / (lo + 0.05); }

const PALETAS = [
  { nome: 'Pôr do sol', chaves: ['por do sol', 'pôr do sol', 'sunset', 'entardecer', 'quente', 'dusk'], fundo: '#1F1147', principal: '#7B2D8E', destaque: '#FF5E62', apoio: '#FFB347', texto: '#FFF6E0' },
  { nome: 'Oceano', chaves: ['oceano', 'mar', 'agua', 'água', 'praia', 'azul'], fundo: '#03233A', principal: '#0B6E99', destaque: '#2EC4B6', apoio: '#CBF3F0', texto: '#F4FBFF' },
  { nome: 'Floresta', chaves: ['floresta', 'natureza', 'verde', 'planta', 'eco', 'folha'], fundo: '#10261A', principal: '#2D6A4F', destaque: '#95D5B2', apoio: '#D8F3DC', texto: '#F6FFF8' },
  { nome: 'Café', chaves: ['cafe', 'café', 'marrom', 'padaria', 'chocolate', 'terra'], fundo: '#2B1B14', principal: '#6F4E37', destaque: '#C68B59', apoio: '#E8D5B7', texto: '#FFF8EE' },
  { nome: 'Neon / cyberpunk', chaves: ['neon', 'cyberpunk', 'noite', 'gamer', 'futuro', 'synthwave'], fundo: '#0B0B1E', principal: '#6C2BD9', destaque: '#00F0FF', apoio: '#FF2E97', texto: '#F2F2FF' },
  { nome: 'Pastel suave', chaves: ['pastel', 'suave', 'fofo', 'delicado', 'bebe', 'bebê'], fundo: '#FFF5F7', principal: '#BDE0FE', destaque: '#FFAFCC', apoio: '#CDB4DB', texto: '#4A4458' },
  { nome: 'Retrô anos 80', chaves: ['retro', 'retrô', 'anos 80', 'vintage', '80s'], fundo: '#2A1B3D', principal: '#44318D', destaque: '#E84A5F', apoio: '#FFC857', texto: '#FDF6E3' },
  { nome: 'Minimalista', chaves: ['minimalista', 'sobrio', 'sóbrio', 'preto e branco', 'monocromatico', 'clean'], fundo: '#FAFAFA', principal: '#1F2937', destaque: '#2563EB', apoio: '#D1D5DB', texto: '#111827' },
  { nome: 'Luxo (preto e dourado)', chaves: ['luxo', 'dourado', 'elegante', 'premium', 'joia', 'joias'], fundo: '#0D0D0D', principal: '#1C1C1C', destaque: '#D4AF37', apoio: '#8C7A3E', texto: '#F5EFD8' },
  { nome: 'Tecnologia', chaves: ['tecnologia', 'tech', 'software', 'startup', 'digital', 'app'], fundo: '#0F172A', principal: '#2563EB', destaque: '#22D3EE', apoio: '#94A3B8', texto: '#F8FAFC' },
  { nome: 'Infantil alegre', chaves: ['infantil', 'crianca', 'criança', 'divertido', 'festa', 'alegre'], fundo: '#FFF8E1', principal: '#4CC9F0', destaque: '#F72585', apoio: '#FFD60A', texto: '#2B2D42' },
  { nome: 'Outono', chaves: ['outono', 'laranja', 'folhas secas', 'aconchegante'], fundo: '#2F1B12', principal: '#9C4A1A', destaque: '#E07A1F', apoio: '#F2C078', texto: '#FFF3E0' },
  { nome: 'Inverno', chaves: ['inverno', 'gelo', 'neve', 'frio', 'natal'], fundo: '#0E1B2B', principal: '#3A6EA5', destaque: '#A8DADC', apoio: '#E63946', texto: '#F1FAEE' },
  { nome: 'Romântico', chaves: ['romantico', 'romântico', 'rosa', 'amor', 'casamento'], fundo: '#3D0C27', principal: '#9D174D', destaque: '#F472B6', apoio: '#FBCFE8', texto: '#FFF1F7' },
  { nome: 'Saúde e bem-estar', chaves: ['saude', 'saúde', 'bem-estar', 'clinica', 'clínica', 'spa', 'calma'], fundo: '#F0FAF8', principal: '#2A9D8F', destaque: '#E9C46A', apoio: '#A8DADC', texto: '#1D3557' },
];
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

function paletaTool(args) {
  const base = normHex(args.base);
  const out = [];
  if (base) {
    const [h, s, l] = rgbToHsl(hexToRgb(base));
    const mk = (nome, hues) => ({ nome, cores: hues.map((dh) => rgbToHex(hslToRgb([h + dh, s, l]))) });
    const harm = norm(args.harmonia || 'analoga');
    const tabela = { analoga: mk('Análoga', [-30, 0, 30]), complementar: mk('Complementar', [0, 180]), triade: mk('Tríade', [0, 120, 240]), tetrade: mk('Tétrade', [0, 90, 180, 270]) };
    const escolhida = tabela[harm] || tabela.analoga;
    const mono = { nome: 'Monocromática', cores: [0.15, 0.3, 0.5, 0.7, 0.9].map((ll) => rgbToHex(hslToRgb([h, s, ll]))) };
    out.push({ base, ...escolhida }, mono);
  } else {
    const q = norm(args.tema);
    let lista = q ? PALETAS.filter((p) => p.chaves.some((c) => q.includes(norm(c)) || norm(c).includes(q))) : [];
    if (!lista.length) lista = PALETAS.slice(0, 15);
    out.push(...lista.slice(0, q ? 4 : 15).map(({ chaves, ...p }) => p));
  }
  return text(JSON.stringify({ observacao: 'fundo/principal/destaque/apoio/texto são papéis sugeridos; deixe uma cor dominar e use o destaque com moderação.', paletas: out }, null, 1));
}

const TAMANHOS = [
  ['Post feed (Instagram)', 1080, 1080], ['Post retrato (Instagram)', 1080, 1350], ['Story / Reels / TikTok', 1080, 1920],
  ['Capa de vídeo YouTube', 1280, 720], ['Banner de canal YouTube', 2560, 1440], ['Capa do Facebook', 820, 312],
  ['Capa do X (Twitter)', 1500, 500], ['Banner do LinkedIn', 1584, 396], ['Foto de perfil / avatar', 1024, 1024],
  ['Imagem de compartilhamento (OG)', 1200, 628], ['Ícone de app', 1024, 1024], ['Papel de parede celular', 1080, 2400],
  ['Papel de parede desktop (Full HD)', 1920, 1080], ['Papel de parede 4K', 3840, 2160], ['A4 (retrato)', 595, 842],
  ['A3 (retrato)', 842, 1191], ['Carta (padrão do VectorCraft)', 612, 792], ['Cartão de visita 90x50 mm', 255, 142],
  ['Cartaz padrão', 600, 800], ['Logo (horizontal)', 1200, 400],
];
function tamanhosTool(args) {
  const q = norm(args.busca);
  const lista = TAMANHOS.filter(([n]) => !q || norm(n).includes(q)).map(([nome, largura, altura]) => ({ nome, largura, altura }));
  return text(JSON.stringify({ unidade: 'pontos (1 ponto = 1 pixel nas telas)', tamanhos: lista.length ? lista : TAMANHOS.map(([nome, largura, altura]) => ({ nome, largura, altura })) }, null, 1));
}

function contrasteTool(args) {
  const a = normHex(args.texto), b = normHex(args.fundo);
  if (!a || !b) return text('Informe "texto" e "fundo" como cores hexadecimais, ex.: #FFFFFF.', { isError: true });
  const r = contrast(a, b);
  const branco = contrast('#ffffff', b), preto = contrast('#000000', b);
  return text(JSON.stringify({
    texto: a, fundo: b, razao: Math.round(r * 100) / 100,
    texto_normal: r >= 7 ? 'AAA' : r >= 4.5 ? 'AA' : 'reprovado (precisa de 4.5 ou mais)',
    texto_grande: r >= 4.5 ? 'AAA' : r >= 3 ? 'AA' : 'reprovado (precisa de 3 ou mais)',
    sugestao: r >= 4.5 ? 'ok' : (branco >= preto ? 'use branco (#FFFFFF) sobre este fundo' : 'use preto (#000000) sobre este fundo'),
  }, null, 1));
}

function acharBase64(res) {
  const vistos = [];
  const visita = (o, d = 0) => {
    if (!o || d > 6) return null;
    if (typeof o === 'string') { vistos.push(o); return null; }
    if (typeof o === 'object') {
      if (typeof o.dataBase64 === 'string') return o.dataBase64;
      if (typeof o.data === 'string' && /image|base64/i.test(String(o.mimeType || o.type || 'base64'))) return o.data;
      for (const v of Object.values(o)) { const r = visita(v, d + 1); if (r) return r; }
    }
    return null;
  };
  const direto = visita(res);
  if (direto) return direto;
  for (const s of vistos) { try { const r = visita(JSON.parse(s)); if (r) return r; } catch { /* ignora */ } }
  return null;
}

async function exportarTool(args) {
  const formato = norm(args.formato || 'svg') === 'png' ? 'png' : 'svg';
  const params = { format: formato };
  if (formato === 'png') params.options = { background: args.fundo || 'white', ...(args.largura ? { width: Number(args.largura) } : {}) };
  if (formato === 'svg') params.outlineText = args.converter_texto_em_curvas === true;
  let msg;
  try { msg = await callChild('tools/call', { name: 'export', arguments: params }); } catch (e) { return text('Falha ao exportar: ' + e.message, { isError: true }); }
  if (msg.error) return text('O VectorCraft recusou a exportação: ' + (msg.error.message || JSON.stringify(msg.error)), { isError: true });
  if (msg.result?.isError) return text('O VectorCraft recusou a exportação: ' + JSON.stringify(msg.result.content || msg.result).slice(0, 800), { isError: true });
  const b64 = acharBase64(msg.result);
  if (!b64) return text('Exportação sem dados inline. Resposta bruta: ' + JSON.stringify(msg.result).slice(0, 800), { isError: true });
  if (b64.length > 5_000_000) return text('Arquivo grande demais para devolver na conversa. Simplifique a arte ou exporte em tamanho menor.', { isError: true });
  if (formato === 'svg') return text(Buffer.from(b64, 'base64').toString('utf8'));
  return { content: [{ type: 'image', data: b64, mimeType: 'image/png' }, { type: 'text', text: 'PNG exportado.' }] };
}

const LOCAL_TOOLS = [
  { name: 'vc_paleta', description: 'Sugere paletas de cores harmônicas. Passe "tema" em português (ex.: "oceano", "luxo", "pastel") ou uma cor "base" em hexadecimal com "harmonia" (analoga, complementar, triade, tetrade). Sem argumentos lista todas.',
    inputSchema: { type: 'object', properties: { tema: { type: 'string' }, base: { type: 'string' }, harmonia: { type: 'string' } } }, run: async (a) => paletaTool(a) },
  { name: 'vc_tamanhos', description: 'Lista tamanhos prontos de prancheta (redes sociais, papel, cartão, papel de parede). "busca" filtra por nome.',
    inputSchema: { type: 'object', properties: { busca: { type: 'string' } } }, run: async (a) => tamanhosTool(a) },
  { name: 'vc_contraste', description: 'Calcula o contraste entre cor de texto e de fundo (WCAG) e diz se é legível.',
    inputSchema: { type: 'object', properties: { texto: { type: 'string' }, fundo: { type: 'string' } }, required: ['texto', 'fundo'] }, run: async (a) => contrasteTool(a) },
  { name: 'vc_exportar', description: 'Exporta o documento aberto e DEVOLVE o conteúdo na conversa: formato "svg" devolve o código SVG (salve como arquivo .svg para entregar); "png" devolve uma imagem. Use no fim do trabalho.',
    inputSchema: { type: 'object', properties: { formato: { type: 'string', enum: ['svg', 'png'] }, largura: { type: 'number' }, fundo: { type: 'string' }, converter_texto_em_curvas: { type: 'boolean' } } }, run: exportarTool },
];
const LOCAL_BY_NAME = new Map(LOCAL_TOOLS.map((t) => [t.name, t]));
const PROMPT_BY_NAME = new Map(PROMPTS.map((p) => [p.name, p]));

// ---------------------------------------------------------------- roteamento
const pending = new Map(); // id do cliente -> 'init' | 'prompts' | 'tools'

readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  if (!line.trim()) return;
  let msg; try { msg = JSON.parse(line); } catch { toChild(line); return; }
  const { id, method, params } = msg;
  try {
    if (method === 'prompts/get' && PROMPT_BY_NAME.has(params?.name)) {
      const p = PROMPT_BY_NAME.get(params.name);
      return ok(id, { description: p.description, messages: [{ role: 'user', content: { type: 'text', text: p.build(params.arguments || {}) } }] });
    }
    if (method === 'tools/call' && LOCAL_BY_NAME.has(params?.name)) {
      const r = await LOCAL_BY_NAME.get(params.name).run(params.arguments || {});
      return ok(id, r);
    }
    if (id !== undefined && method === 'initialize') pending.set(id, 'init');
    else if (id !== undefined && method === 'prompts/list' && !params?.cursor) pending.set(id, 'prompts');
    else if (id !== undefined && method === 'tools/list' && !params?.cursor) pending.set(id, 'tools');
    toChild(msg);
  } catch (e) {
    if (id !== undefined) fail(id, -32603, 'Erro interno do vc-pt-proxy: ' + e.message);
  }
});

readline.createInterface({ input: child.stdout }).on('line', (line) => {
  if (!line.trim()) return;
  let msg; try { msg = JSON.parse(line); } catch { process.stdout.write(line + '\n'); return; }
  if (msg.id !== undefined && msg.method === undefined && internal.has(msg.id)) {
    const r = internal.get(msg.id); internal.delete(msg.id); return r(msg);
  }
  const kind = msg.id !== undefined && msg.method === undefined ? pending.get(msg.id) : undefined;
  if (kind) {
    pending.delete(msg.id);
    if (kind === 'init' && msg.result) {
      msg.result.instructions = (msg.result.instructions ? msg.result.instructions + '\n\n' : '') + INSTRUCOES;
      msg.result.capabilities = { ...(msg.result.capabilities || {}) };
      msg.result.capabilities.prompts = msg.result.capabilities.prompts || {};
      msg.result.capabilities.tools = msg.result.capabilities.tools || {};
    } else if (kind === 'prompts') {
      const ours = PROMPTS.map(({ build, ...p }) => p);
      msg = msg.error ? { jsonrpc: '2.0', id: msg.id, result: { prompts: ours } }
        : { ...msg, result: { ...msg.result, prompts: [...ours, ...(msg.result?.prompts || [])] } };
    } else if (kind === 'tools') {
      const ours = LOCAL_TOOLS.map(({ run, ...t }) => t);
      msg = msg.error ? { jsonrpc: '2.0', id: msg.id, result: { tools: ours } }
        : { ...msg, result: { ...msg.result, tools: [...(msg.result?.tools || []), ...ours] } };
    }
  }
  toClient(msg);
});
