const firebaseConfig = {
  apiKey: "AIzaSyCQBtTrb6tWfcEzR-6JQ2Cyob3v26g19oA",
  authDomain: "agnails-47044.firebaseapp.com",
  projectId: "agnails-47044",
  storageBucket: "agnails-47044.firebasestorage.app",
  messagingSenderId: "669802553809",
  appId: "1:669802553809:web:43ae6ea9cd0aa6d05380f0"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const AGNAIL_RECAPTCHA_V3_SITE_KEY = '6LeZynctAAAAAPS8DMMJiqvj7B2ldwuggpQ2qZC3';
try {
  if (typeof firebase.appCheck === 'function' && AGNAIL_RECAPTCHA_V3_SITE_KEY !== 'RECAPTCHA_V3_SITE_KEY') {
    firebase.appCheck().activate(AGNAIL_RECAPTCHA_V3_SITE_KEY, true);
  }
} catch (e) {
  console.warn('App Check não pôde ser ativado (verifique a site key no Firebase Console):', e);
}

const auth = firebase.auth();
const db = firebase.firestore();
const googleProvider = new firebase.auth.GoogleAuthProvider();

const AGNAIL_DIAS_TESTE_PADRAO = 15;
const AGNAIL_MAX_IMG_KB = 800;
const AGNAIL_ALVO_IMG_KB = 750;
const AGNAIL_MAX_PDF_KB = 800;
const AGNAIL_DIAS_RETENCAO_EXCLUSAO = 90;
const AGNAIL_MIN_PROFISSIONAIS_STUDIO = 2;

function agnailLoginGoogle() {
  // F18: em navegadores/WebViews que bloqueiam pop-up (comum em apps móveis
  // e alguns navegadores in-app), cai para signInWithRedirect. O resultado do
  // redirect é capturado normalmente pelo listener onAuthStateChanged já
  // existente em cada página (login.html, adm.html), então nenhum tratamento
  // adicional é necessário nos pontos de chamada.
  return auth.signInWithPopup(googleProvider).catch((erro) => {
    const CODIGOS_FALLBACK_REDIRECT = [
      'auth/popup-blocked',
      'auth/operation-not-supported-in-this-environment'
    ];
    if (CODIGOS_FALLBACK_REDIRECT.includes(erro && erro.code)) {
      return auth.signInWithRedirect(googleProvider);
    }
    throw erro;
  });
}

function agnailLogout() {
  return auth.signOut();
}

function agnailOnAuthChange(callback) {
  return auth.onAuthStateChanged(callback);
}

function agnailArquivoParaBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function agnailBase64SizeKB(base64) {
  const semCabecalho = base64.split(',')[1] || base64;
  return (semCabecalho.length * 0.75) / 1024;
}

function agnailCarregarImagem(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function agnailProcessarImagem(file) {
  if (!file) return '';

  const base64Original = await agnailArquivoParaBase64(file);

  const tamanhoBase64KB = agnailBase64SizeKB(base64Original);
  if (tamanhoBase64KB <= AGNAIL_MAX_IMG_KB) {
    return base64Original;
  }

  const img = await agnailCarregarImagem(base64Original);
  let largura = img.width;
  let altura = img.height;
  let qualidade = 0.85;
  let resultado = base64Original;

  for (let tentativa = 0; tentativa < 8; tentativa++) {
    const canvas = document.createElement('canvas');
    canvas.width = largura;
    canvas.height = altura;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, largura, altura);
    resultado = canvas.toDataURL('image/jpeg', qualidade);

    const tamanhoAtualKB = agnailBase64SizeKB(resultado);
    if (tamanhoAtualKB <= AGNAIL_ALVO_IMG_KB) break;

    if (qualidade > 0.4) {
      qualidade -= 0.15;
    } else {
      largura = Math.round(largura * 0.8);
      altura = Math.round(altura * 0.8);
    }
  }
  return resultado;
}

function agnailArquivoEhPdf(file) {
  if (!file) return false;
  if (file.type === 'application/pdf') return true;
  return /\.pdf$/i.test(file.name || '');
}

async function agnailProcessarComprovante(file) {
  if (!file) return '';

  if (!agnailArquivoEhPdf(file)) {
    return agnailProcessarImagem(file);
  }

  const base64Bruto = await agnailArquivoParaBase64(file);

  const dadosBase64 = (base64Bruto.split(',')[1] || '');
  const base64 = `data:application/pdf;base64,${dadosBase64}`;

  const tamanhoKB = agnailBase64SizeKB(base64);
  if (tamanhoKB > AGNAIL_MAX_PDF_KB) {
    throw new Error(
      `Este PDF está muito grande (${Math.round(tamanhoKB)}KB). ` +
      `Envie um arquivo de até ${AGNAIL_MAX_PDF_KB}KB, ou tire uma foto/print do comprovante em vez do PDF.`
    );
  }
  return base64;
}

function agnailEscaparHTML(valor) {
  const div = document.createElement('div');
  div.textContent = (valor === null || valor === undefined) ? '' : String(valor);
  return div.innerHTML;
}

function agnailEscaparAtributo(valor) {
  return agnailEscaparHTML(valor).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function agnailMascararCelular(valor) {
  let v = (valor || '').replace(/\D/g, '').slice(0, 11);
  if (v.length > 10) {
    v = v.replace(/(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3');
  } else if (v.length > 5) {
    v = v.replace(/(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3');
  } else if (v.length > 2) {
    v = v.replace(/(\d{2})(\d{0,5})/, '($1) $2');
  } else if (v.length > 0) {
    v = v.replace(/(\d{0,2})/, '($1');
  }
  return v.trim().replace(/-$/, '').replace(/\)\s*$/, ') ').trimEnd();
}

function agnailAplicarMascaraCelular(input) {
  if (!input) return;
  input.setAttribute('inputmode', 'numeric');
  input.setAttribute('maxlength', '15');
  input.addEventListener('input', function () {
    const posicaoAntes = input.selectionStart;
    const tamanhoAntes = input.value.length;
    input.value = agnailMascararCelular(input.value);
    const diff = input.value.length - tamanhoAntes;
    const novaPos = Math.max(0, (posicaoAntes || 0) + diff);
    input.setSelectionRange(novaPos, novaPos);
  });
}

function agnailLimitarTexto(alvo, limite) {
  limite = limite || 50;
  let elementos = [];
  if (typeof alvo === 'string') {
    elementos = Array.from(document.querySelectorAll(alvo));
  } else if (alvo instanceof NodeList || Array.isArray(alvo)) {
    elementos = Array.from(alvo);
  } else if (alvo) {
    elementos = [alvo];
  }
  elementos.forEach((el) => {
    if (!el || !el.setAttribute) return;
    el.setAttribute('maxlength', String(limite));
  });
}

async function agnailGetConfigSistema() {
  const padrao = {
    mensalidade: 50,
    diasTeste: AGNAIL_DIAS_TESTE_PADRAO,
    chavePix: '',
    whatsappFinanceiro: '',
    valorFuncionariaStudio: 0
  };
  const ref = db.collection('administracao').doc('configuracoes');
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set(padrao);
    return padrao;
  }
  return { ...padrao, ...snap.data() };
}

// Documento separado, de leitura pública, só com o flag de manutenção — ver
// comentário na regra do Firestore (administracao/status) para o motivo de
// não estar junto de administracao/configuracoes.
async function agnailGetStatusSistema() {
  const snap = await db.collection('administracao').doc('status').get();
  return snap.exists ? { manutencao: false, ...snap.data() } : { manutencao: false };
}

async function agnailSetStatusSistema(manutencao) {
  await db.collection('administracao').doc('status').set({ manutencao: !!manutencao });
}

async function agnailSetConfigSistema(dados) {
  await db.collection('administracao').doc('configuracoes').set(dados, { merge: true });
}

function agnailManicureRef(uid) {
  return db.collection('maquiadores').doc(uid);
}

async function agnailCriarEstruturaInicial(user) {
  const configSistema = await agnailGetConfigSistema();
  const agora = firebase.firestore.Timestamp.now();
  const fimTeste = new Date();
  fimTeste.setDate(fimTeste.getDate() + (configSistema.diasTeste || AGNAIL_DIAS_TESTE_PADRAO));

  const perfil = {
    nomeEmpresa: '',
    slogan: '',
    imagemPerfil: '',
    perfilCompleto: false,
    criadoEm: agora,
    atualizadoEm: agora
  };

  const perfilPrivado = {
    nomeResponsavel: user.displayName || '',
    email: user.email || '',
    telefone: '',
    termosAceitos: false,
    termosAceitosEm: null
  };

  const assinatura = {
    status: 'teste_gratuito',
    plano: 'padrao',
    inicioTeste: agora,
    fimTeste: firebase.firestore.Timestamp.fromDate(fimTeste),
    vencimento: firebase.firestore.Timestamp.fromDate(fimTeste),
    ultimoPagamento: null,
    acessoLiberado: true,
    dataSolicitacaoExclusao: null,
    dataExclusaoPermitida: null
  };

  const configuracoes = {
    nomeEmpresa: '',
    slogan: '',
    whatsapp: '',
    imagem: '',
    horarioInicio: '',
    horarioFim: '',
    intervaloMinutos: 60,
    diasFolga: [],
    folgas: [],
    tema: 'rosa',
    formasPagamento: [],
    servicos: []
  };

  const batch = db.batch();
  const userRef = db.collection('usuarios').doc(user.uid);
  batch.set(userRef, {
    nome: user.displayName || '',
    email: user.email || '',
    foto: user.photoURL || '',
    tipo: 'manicure',
    statusConta: 'ativa',
    criadoEm: agora,
    ultimoLogin: agora
  });

  const manicureRef = agnailManicureRef(user.uid);
  batch.set(manicureRef.collection('meta').doc('perfil'), perfil);
  batch.set(manicureRef.collection('meta').doc('perfilPrivado'), perfilPrivado);
  batch.set(manicureRef.collection('meta').doc('assinatura'), assinatura);
  batch.set(manicureRef.collection('meta').doc('configuracoes'), configuracoes);

  await batch.commit();
  return { perfil, perfilPrivado, assinatura, configuracoes };
}

async function agnailGetUsuario(uid) {
  const snap = await db.collection('usuarios').doc(uid).get();
  return snap.exists ? snap.data() : null;
}

async function agnailGetAssinatura(uid) {
  const snap = await agnailManicureRef(uid).collection('meta').doc('assinatura').get();
  return snap.exists ? snap.data() : null;
}

async function agnailGetPerfil(uid) {
  const snap = await agnailManicureRef(uid).collection('meta').doc('perfil').get();
  return snap.exists ? snap.data() : null;
}

async function agnailGetPerfilPrivado(uid) {
  const snap = await agnailManicureRef(uid).collection('meta').doc('perfilPrivado').get();
  return snap.exists ? snap.data() : null;
}

async function agnailGetPerfilCompleto(uid) {
  const [perfil, perfilPrivado] = await Promise.all([
    agnailGetPerfil(uid),
    agnailGetPerfilPrivado(uid).catch(() => null)
  ]);
  return { ...(perfil || {}), ...(perfilPrivado || {}) };
}

async function agnailGetConfiguracoes(uid) {
  const snap = await agnailManicureRef(uid).collection('meta').doc('configuracoes').get();
  return snap.exists ? snap.data() : null;
}

function agnailProfissionalRef(uid, profissionalId) {
  return agnailManicureRef(uid).collection('profissionais').doc(profissionalId);
}

async function agnailListarProfissionais(uid) {
  const snap = await agnailManicureRef(uid).collection('profissionais').get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function agnailGetProfissionalPublico(uid, profissionalId) {
  const snap = await agnailProfissionalRef(uid, profissionalId).get();
  return snap.exists ? snap.data() : null;
}

async function agnailGetProfissionalPrivado(uid, profissionalId) {
  const snap = await agnailProfissionalRef(uid, profissionalId).collection('privado').doc('dados').get();
  return snap.exists ? snap.data() : null;
}

async function agnailGetProfissionalCompleto(uid, profissionalId) {
  const [publico, privado] = await Promise.all([
    agnailGetProfissionalPublico(uid, profissionalId),
    agnailGetProfissionalPrivado(uid, profissionalId).catch(() => null)
  ]);
  return { id: profissionalId, ...(publico || {}), ...(privado || {}) };
}

async function agnailCriarProfissional(uid, dadosPublicos, dadosPrivados) {
  const agora = firebase.firestore.Timestamp.now();
  const ref = agnailManicureRef(uid).collection('profissionais').doc();
  const batch = db.batch();
  batch.set(ref, { ...dadosPublicos, criadoEm: agora, atualizadoEm: agora });
  batch.set(ref.collection('privado').doc('dados'), dadosPrivados || {});
  await batch.commit();
  return ref.id;
}

async function agnailAtualizarProfissional(uid, profissionalId, dadosPublicos, dadosPrivados) {
  const batch = db.batch();
  const ref = agnailProfissionalRef(uid, profissionalId);
  if (dadosPublicos) {
    batch.set(ref, { ...dadosPublicos, atualizadoEm: firebase.firestore.Timestamp.now() }, { merge: true });
  }
  if (dadosPrivados) {
    batch.set(ref.collection('privado').doc('dados'), dadosPrivados, { merge: true });
  }
  await batch.commit();
}

function agnailCalcularStatusAcesso(assinatura) {
  if (!assinatura) {
    return { status: 'indefinido', acessoLiberado: false, diasRestantesTeste: 0 };
  }
  if (assinatura.dataSolicitacaoExclusao) {
    return { status: 'exclusao_solicitada', acessoLiberado: false, diasRestantesTeste: 0 };
  }

  const agora = new Date();

  if (assinatura.status === 'teste_gratuito') {
    const fimTeste = assinatura.fimTeste ? assinatura.fimTeste.toDate() : null;
    if (fimTeste && agora <= fimTeste) {
      const diasRestantes = Math.max(0, Math.ceil((fimTeste - agora) / 86400000));
      return { status: 'teste_gratuito', acessoLiberado: true, diasRestantesTeste: diasRestantes };
    }
    return { status: 'expirado', acessoLiberado: false, diasRestantesTeste: 0 };
  }

  if (assinatura.status === 'aguardando_aprovacao') {
    return { status: 'aguardando_aprovacao', acessoLiberado: false, diasRestantesTeste: 0 };
  }

  if (assinatura.status === 'ativo') {
    const vencimento = assinatura.vencimento ? assinatura.vencimento.toDate() : null;
    if (vencimento && agora > vencimento) {
      return { status: 'expirado', acessoLiberado: false, diasRestantesTeste: 0 };
    }
    return { status: 'ativo', acessoLiberado: true, diasRestantesTeste: 0 };
  }

  return { status: assinatura.status || 'expirado', acessoLiberado: !!assinatura.acessoLiberado, diasRestantesTeste: 0 };
}

async function agnailProcessarPosLogin(user) {
  const usuarioExistente = await agnailGetUsuario(user.uid);

  if (!usuarioExistente) {
    await agnailCriarEstruturaInicial(user);
    await db.collection('administracao').doc('logs').collection('entradas').add({
      usuario: user.email,
      acao: 'primeiro_cadastro',
      dataHora: firebase.firestore.Timestamp.now(),
      detalhes: 'Estrutura inicial criada'
    });
    const assinatura = await agnailGetAssinatura(user.uid);
    return { novoUsuario: true, statusAcesso: agnailCalcularStatusAcesso(assinatura) };
  }

  await db.collection('usuarios').doc(user.uid).set({
    ultimoLogin: firebase.firestore.Timestamp.now(),
    nome: user.displayName || usuarioExistente.nome,
    foto: user.photoURL || usuarioExistente.foto || ''
  }, { merge: true });

  if (usuarioExistente.statusConta === 'exclusao_solicitada') {
    await db.collection('usuarios').doc(user.uid).set({ statusConta: 'ativa' }, { merge: true });
    await agnailManicureRef(user.uid).collection('meta').doc('assinatura').set({
      dataSolicitacaoExclusao: null,
      dataExclusaoPermitida: null
    }, { merge: true });
    await db.collection('administracao').doc('contasPendentesExclusao')
      .collection('contas').doc(user.uid).delete().catch(() => {});
    await db.collection('administracao').doc('logs').collection('entradas').add({
      usuario: user.email,
      acao: 'conta_restaurada',
      dataHora: firebase.firestore.Timestamp.now(),
      detalhes: 'Login realizado durante o período de retenção; exclusão cancelada.'
    });
  }

  const assinatura = await agnailGetAssinatura(user.uid);
  return { novoUsuario: false, statusAcesso: agnailCalcularStatusAcesso(assinatura) };
}

async function agnailSolicitarExclusaoConta(uid, emailUsuario) {
  const agora = new Date();
  const dataPermitida = new Date();
  dataPermitida.setDate(dataPermitida.getDate() + AGNAIL_DIAS_RETENCAO_EXCLUSAO);

  await db.collection('usuarios').doc(uid).set({ statusConta: 'exclusao_solicitada' }, { merge: true });
  await agnailManicureRef(uid).collection('meta').doc('assinatura').set({
    dataSolicitacaoExclusao: firebase.firestore.Timestamp.fromDate(agora),
    dataExclusaoPermitida: firebase.firestore.Timestamp.fromDate(dataPermitida)
  }, { merge: true });

  await db.collection('administracao').doc('contasPendentesExclusao')
    .collection('contas').doc(uid).set({
      uid,
      email: emailUsuario,
      dataSolicitacaoExclusao: firebase.firestore.Timestamp.fromDate(agora),
      dataExclusaoPermitida: firebase.firestore.Timestamp.fromDate(dataPermitida)
    });

  await db.collection('administracao').doc('logs').collection('entradas').add({
    usuario: emailUsuario,
    acao: 'exclusao_solicitada',
    dataHora: firebase.firestore.Timestamp.now(),
    detalhes: `Exclusão definitiva liberada em ${dataPermitida.toLocaleDateString('pt-BR')}`
  });
}

async function agnailExcluirContaPermanentemente(uid) {
  const TAMANHO_MAXIMO_LOTE = 500;

  let continuarProfissionais = true;
  while (continuarProfissionais) {
    const profissionaisSnap = await agnailManicureRef(uid).collection('profissionais').limit(TAMANHO_MAXIMO_LOTE).get();
    if (profissionaisSnap.empty) { continuarProfissionais = false; break; }
    for (const profDoc of profissionaisSnap.docs) {
      let continuarSlots = true;
      while (continuarSlots) {
        const slotsSnap = await profDoc.ref.collection('disponibilidade').limit(TAMANHO_MAXIMO_LOTE).get();
        if (slotsSnap.empty) { continuarSlots = false; break; }
        const batchSlots = db.batch();
        slotsSnap.docs.forEach((d) => batchSlots.delete(d.ref));
        await batchSlots.commit();
        continuarSlots = slotsSnap.docs.length === TAMANHO_MAXIMO_LOTE;
      }
      await profDoc.ref.collection('privado').doc('dados').delete().catch(() => {});
    }
    const batchProfissionais = db.batch();
    profissionaisSnap.docs.forEach((d) => batchProfissionais.delete(d.ref));
    await batchProfissionais.commit();
    continuarProfissionais = profissionaisSnap.docs.length === TAMANHO_MAXIMO_LOTE;
  }

  const subcolecoes = ['servicos', 'clientes', 'agendamentos', 'disponibilidade', 'financeiro', 'pagamentos', 'notificacoes', 'meta'];
  for (const nome of subcolecoes) {
    let continuar = true;
    while (continuar) {
      const snap = await agnailManicureRef(uid).collection(nome).limit(TAMANHO_MAXIMO_LOTE).get();
      if (snap.empty) { continuar = false; break; }
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      continuar = snap.docs.length === TAMANHO_MAXIMO_LOTE;
    }
  }
  // F19: se havia algum pagamento aguardando aprovação no momento da exclusão,
  // o ponteiro em administracao/pagamentosPendentes/itens ficaria órfão
  // (apontando para um uid/pagamentoId que não existe mais). A UI do admin já
  // tolerava isso silenciosamente, mas o ideal é não deixar lixo acumular.
  const pendentesOrfaosSnap = await db.collection('administracao').doc('pagamentosPendentes')
    .collection('itens').where('uid', '==', uid).get();
  if (!pendentesOrfaosSnap.empty) {
    const batchPendentesOrfaos = db.batch();
    pendentesOrfaosSnap.docs.forEach((d) => batchPendentesOrfaos.delete(d.ref));
    await batchPendentesOrfaos.commit();
  }

  await db.collection('usuarios').doc(uid).delete();
  await db.collection('administracao').doc('contasPendentesExclusao').collection('contas').doc(uid).delete();
}

async function agnailLiberarSlotsAgendamento(uid, agendamento, profissionalId) {
  if (!agendamento || !Array.isArray(agendamento.slotsDisponibilidade) || !agendamento.slotsDisponibilidade.length) {
    return;
  }
  const colecaoDisponibilidade = profissionalId
    ? agnailProfissionalRef(uid, profissionalId).collection('disponibilidade')
    : agnailManicureRef(uid).collection('disponibilidade');
  const batch = db.batch();
  agendamento.slotsDisponibilidade.forEach((slotId) => {
    batch.delete(colecaoDisponibilidade.doc(slotId));
  });
  await batch.commit();
}

async function agnailCalcularValorMensalidadeStudio(uid) {
  const [configSistema, profissionais] = await Promise.all([
    agnailGetConfigSistema(),
    agnailListarProfissionais(uid)
  ]);
  const valorPorFuncionaria = configSistema.valorFuncionariaStudio || 0;

  // F11: as profissionais ativas contam direto; as inativas precisam de uma
  // consulta para saber se ainda têm agendamento pendente. Antes isso rodava
  // em série (um round-trip ao Firestore por vez); agora roda em paralelo.
  const profissionaisInativas = profissionais.filter((p) => !p.ativo);
  const resultadosInativas = await Promise.all(
    profissionaisInativas.map((p) =>
      agnailManicureRef(uid).collection('agendamentos')
        .where('professionalId', '==', p.id)
        .where('status', '==', 'agendado')
        .limit(1)
        .get()
    )
  );
  const numAtivas = profissionais.filter((p) => p.ativo).length;
  const numInativasCobraveis = resultadosInativas.filter((snap) => !snap.empty).length;
  const numProfissionaisCobraveis = numAtivas + numInativasCobraveis;

  return {
    numProfissionaisCobraveis,
    valorPorFuncionaria,
    valorTotal: numProfissionaisCobraveis * valorPorFuncionaria
  };
}

async function agnailEnviarComprovante(uid, file) {
  const base64 = await agnailProcessarComprovante(file);
  const agora = firebase.firestore.Timestamp.now();

  const competencia = new Date().toISOString().slice(0, 7);
  const pagamentoRef = agnailManicureRef(uid).collection('pagamentos').doc();
  const configSistema = await agnailGetConfigSistema();

  let valor = configSistema.mensalidade || 50;
  try {
    const configuracoesConta = await agnailGetConfiguracoes(uid);
    if (configuracoesConta && configuracoesConta.modo === 'studio') {
      const calculo = await agnailCalcularValorMensalidadeStudio(uid);
      valor = calculo.valorTotal;
    }
  } catch (e) {
    console.error('Erro ao calcular valor da mensalidade Studio (usando valor padrão):', e);
  }

  await pagamentoRef.set({
    competencia,
    valor,
    status: 'aguardando_aprovacao',
    comprovante: base64,
    observacoes: '',
    enviadoEm: agora,
    aprovadoEm: null,
    aprovadoPor: null
  });

  await agnailManicureRef(uid).collection('meta').doc('assinatura').set({
    status: 'aguardando_aprovacao'
  }, { merge: true });

  await db.collection('administracao').doc('pagamentosPendentes').collection('itens').doc(pagamentoRef.id).set({
    uid,
    pagamentoId: pagamentoRef.id,
    enviadoEm: agora
  });

  return pagamentoRef.id;
}

const AGNAIL_SUPORTE_EMAIL = 'tecminia@gmail.com';
const AGNAIL_SUPORTE_WHATSAPP_URL = 'https://wa.me/5592986451591?text=' + encodeURIComponent('Olá! Preciso de ajuda com o Agnayls.');

function agnailAbrirModalSuporte(aoFechar) {
  let overlay = document.getElementById('overlaySuporteAgnail');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'overlaySuporteAgnail';
    overlay.className = 'overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);display:none;align-items:center;justify-content:center;padding:20px;z-index:500;';
    overlay.innerHTML = `
      <div style="background:var(--card,#fff); border-radius:var(--radius,20px); padding:30px 24px; max-width:380px; width:100%; text-align:center; box-shadow:var(--sombra-lg,0 12px 40px rgba(0,0,0,0.2)); position:relative; font-family:'Nunito',system-ui,sans-serif; color:var(--texto,#5d4a5c);">
        <button id="btnFecharSuporteAgnail" type="button" style="position:absolute; top:12px; right:12px; width:32px; height:32px; border-radius:50%; border:none; background:var(--rosa-claro,#fbeaef); color:var(--rosa-escuro,#c47d8f); cursor:pointer; font-size:1rem; display:flex; align-items:center; justify-content:center;"><i class="fa-solid fa-xmark"></i></button>
        <div style="font-size:2.2rem; margin-bottom:8px;">💬</div>
        <h2 style="font-family:'Playfair Display',serif; font-size:1.25rem; font-weight:500; margin-bottom:8px;">Precisa de ajuda?</h2>
        <p style="color:var(--texto-claro,#8a7a89); font-size:0.88rem; line-height:1.5; margin-bottom:18px;">Fale com a gente por e-mail ou WhatsApp para dúvidas, reclamações e tutoriais de como usar o Agnayls.</p>
        <a href="mailto:${AGNAIL_SUPORTE_EMAIL}" style="display:flex; align-items:center; justify-content:center; gap:8px; width:100%; padding:12px; border-radius:var(--radius-sm,12px); background:var(--rosa-escuro,#c47d8f); color:#fff; text-decoration:none; font-weight:600; font-size:0.9rem; margin-bottom:10px;"><i class="fa-solid fa-envelope"></i> ${AGNAIL_SUPORTE_EMAIL}</a>
        <a href="${AGNAIL_SUPORTE_WHATSAPP_URL}" target="_blank" rel="noopener" style="display:flex; align-items:center; justify-content:center; gap:8px; width:100%; padding:12px; border-radius:var(--radius-sm,12px); background:#25D366; color:#fff; text-decoration:none; font-weight:600; font-size:0.9rem;"><i class="fa-brands fa-whatsapp"></i> Falar no WhatsApp</a>
      </div>
    `;
    document.body.appendChild(overlay);

    const fechar = function () {
      overlay.style.display = 'none';
      overlay.classList.remove('active', 'show');
      const callback = overlay._agnailAoFechar;
      overlay._agnailAoFechar = null;
      if (typeof callback === 'function') callback();
    };
    overlay.querySelector('#btnFecharSuporteAgnail').addEventListener('click', fechar);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) fechar();
    });
  }
  overlay._agnailAoFechar = aoFechar || null;
  overlay.style.display = 'flex';
  overlay.classList.add('active');
}

async function agnailSistemaEmManutencao() {
  try {
    const statusSistema = await agnailGetStatusSistema();
    return !!statusSistema.manutencao;
  } catch (e) {
    // administracao/status agora é de leitura pública, então isto não deveria
    // mais falhar por permissão — mas mantém o fail-open pra qualquer falha
    // de rede/infra: a checagem de manutenção é uma conveniência operacional,
    // não um controle de segurança, então nunca deve travar o usuário por
    // conta própria.
    console.warn('Não foi possível verificar o modo de manutenção (seguindo normalmente):', e);
    return false;
  }
}

function agnailExibirTelaManutencao(mensagemPersonalizada) {
  let overlay = document.getElementById('overlayManutencaoAgnail');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'overlayManutencaoAgnail';
    overlay.style.cssText = 'position:fixed;inset:0;background:var(--bg,#fdf6f9);display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;padding:24px;z-index:99999;text-align:center;font-family:\'Nunito\',system-ui,sans-serif;color:var(--texto,#5d4a5c);';
    overlay.innerHTML = `
      <div style="font-size:2.6rem;">🛠️</div>
      <h2 style="font-family:'Playfair Display',serif; font-weight:500; font-size:1.3rem; margin:0;">Sistema em manutenção</h2>
      <p id="agnailManutencaoMsg" style="max-width:380px; font-size:0.9rem; color:var(--texto-claro,#8a7a89); line-height:1.5; margin:0;"></p>
    `;
    document.body.appendChild(overlay);
  }
  // textContent (nunca innerHTML) — seguro mesmo se um dia a mensagem vier de fonte externa.
  document.getElementById('agnailManutencaoMsg').textContent =
    mensagemPersonalizada || 'Estamos com uma manutenção programada em andamento. Tente novamente em alguns minutos.';
  overlay.style.display = 'flex';
}

function agnailCriarPaginador(queryBase, tamanhoPagina) {
  let cursores = [];
  let paginaAtualIndex = -1;
  let ultimaPaginaCheia = true;

  async function buscarPagina(index) {
    let q = queryBase.limit(tamanhoPagina);
    if (index > 0) {
      const cursorAnterior = cursores[index - 1];
      if (!cursorAnterior) return [];
      q = q.startAfter(cursorAnterior);
    }
    const snap = await q.get();
    if (snap.docs.length > 0) {
      cursores[index] = snap.docs[snap.docs.length - 1];
    }
    ultimaPaginaCheia = snap.docs.length === tamanhoPagina;
    paginaAtualIndex = index;
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  return {
    primeira: () => { cursores = []; paginaAtualIndex = -1; return buscarPagina(0); },
    proxima: () => (paginaAtualIndex >= 0 && ultimaPaginaCheia) ? buscarPagina(paginaAtualIndex + 1) : Promise.resolve([]),
    anterior: () => (paginaAtualIndex > 0) ? buscarPagina(paginaAtualIndex - 1) : Promise.resolve([]),
    recarregarAtual: () => (paginaAtualIndex >= 0) ? buscarPagina(paginaAtualIndex) : Promise.resolve([]),
    temProxima: () => paginaAtualIndex >= 0 && ultimaPaginaCheia,
    temAnterior: () => paginaAtualIndex > 0,
    numeroPagina: () => paginaAtualIndex + 1
  };
}

function agnailRenderizarControlesPaginacao(containerId, paginador, callbackAnterior, callbackProxima) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const pagina = paginador.numeroPagina();
  const temAnterior = paginador.temAnterior();
  const temProxima = paginador.temProxima();

  if (pagina <= 1 && !temProxima) {
    container.innerHTML = '';
    return;
  }

  const estiloBase = "padding:8px 16px;border-radius:50px;border:2px solid var(--rosa,#e4a5b8);background:#fff;color:var(--rosa-escuro,#c47d8f);font-family:'Nunito',system-ui,sans-serif;font-weight:600;font-size:0.82rem;cursor:pointer;";
  const estiloDesabilitado = 'opacity:0.4;cursor:not-allowed;';

  container.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:12px;padding:14px 0;';
  container.innerHTML = `
    <button type="button" id="${containerId}_anterior" style="${estiloBase}${temAnterior ? '' : estiloDesabilitado}" ${temAnterior ? '' : 'disabled'}>‹ Anterior</button>
    <span style="font-size:0.82rem;color:var(--texto-claro,#8a7a89);font-weight:600;">Página ${pagina}</span>
    <button type="button" id="${containerId}_proxima" style="${estiloBase}${temProxima ? '' : estiloDesabilitado}" ${temProxima ? '' : 'disabled'}>Próxima ›</button>
  `;
  const btnAnterior = document.getElementById(containerId + '_anterior');
  const btnProxima = document.getElementById(containerId + '_proxima');
  if (btnAnterior && temAnterior) btnAnterior.addEventListener('click', callbackAnterior);
  if (btnProxima && temProxima) btnProxima.addEventListener('click', callbackProxima);
}

window.Agnayls = {
  auth, db,
  firebaseConfig,
  DIAS_TESTE_PADRAO: AGNAIL_DIAS_TESTE_PADRAO,
  DIAS_RETENCAO_EXCLUSAO: AGNAIL_DIAS_RETENCAO_EXCLUSAO,
  loginGoogle: agnailLoginGoogle,
  logout: agnailLogout,
  onAuthChange: agnailOnAuthChange,
  mascararCelular: agnailMascararCelular,
  aplicarMascaraCelular: agnailAplicarMascaraCelular,
  limitarTexto: agnailLimitarTexto,
  escaparHTML: agnailEscaparHTML,
  escaparAtributo: agnailEscaparAtributo,
  processarImagem: agnailProcessarImagem,
  processarComprovante: agnailProcessarComprovante,
  getConfigSistema: agnailGetConfigSistema,
  setConfigSistema: agnailSetConfigSistema,
  getStatusSistema: agnailGetStatusSistema,
  setStatusSistema: agnailSetStatusSistema,
  manicureRef: agnailManicureRef,
  criarEstruturaInicial: agnailCriarEstruturaInicial,
  getUsuario: agnailGetUsuario,
  getAssinatura: agnailGetAssinatura,
  getPerfil: agnailGetPerfil,
  getPerfilPrivado: agnailGetPerfilPrivado,
  getPerfilCompleto: agnailGetPerfilCompleto,
  getConfiguracoes: agnailGetConfiguracoes,
  calcularStatusAcesso: agnailCalcularStatusAcesso,
  processarPosLogin: agnailProcessarPosLogin,
  solicitarExclusaoConta: agnailSolicitarExclusaoConta,
  excluirContaPermanentemente: agnailExcluirContaPermanentemente,
  liberarSlotsAgendamento: agnailLiberarSlotsAgendamento,
  calcularValorMensalidadeStudio: agnailCalcularValorMensalidadeStudio,
  enviarComprovante: agnailEnviarComprovante,
  abrirModalSuporte: agnailAbrirModalSuporte,
  sistemaEmManutencao: agnailSistemaEmManutencao,
  exibirTelaManutencao: agnailExibirTelaManutencao,
  criarPaginador: agnailCriarPaginador,
  renderizarControlesPaginacao: agnailRenderizarControlesPaginacao,
  MIN_PROFISSIONAIS_STUDIO: AGNAIL_MIN_PROFISSIONAIS_STUDIO,
  profissionalRef: agnailProfissionalRef,
  listarProfissionais: agnailListarProfissionais,
  getProfissionalPublico: agnailGetProfissionalPublico,
  getProfissionalPrivado: agnailGetProfissionalPrivado,
  getProfissionalCompleto: agnailGetProfissionalCompleto,
  criarProfissional: agnailCriarProfissional,
  atualizarProfissional: agnailAtualizarProfissional
};