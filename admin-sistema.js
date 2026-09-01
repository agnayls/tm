(function () {
    let adminAtual = null;
    let configSistemaCache = null;
    let itensPaginaAtualManicures = [];
    let paginadorManicures = null;
    let comprovantesPdfCache = {};

    function mostrarToast(msg, tipo) {
        const t = document.getElementById('toast');
        t.textContent = msg;
        t.className = 'toast ' + (tipo || '');
        void t.offsetWidth;
        t.classList.add('show');
        clearTimeout(t._timeout);
        t._timeout = setTimeout(() => t.classList.remove('show'), 3000);
    }

    function formatarData(timestamp) {
        if (!timestamp) return '-';
        const d = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return d.toLocaleDateString('pt-BR');
    }

    function badgeStatus(status) {
        const mapa = {
            teste_gratuito: ['badge-teste', 'Teste Grátis'],
            aguardando_aprovacao: ['badge-aguardando', 'Aguardando Aprovação'],
            ativo: ['badge-ativo', 'Plano Ativo'],
            expirado: ['badge-expirado', 'Plano Expirado'],
            exclusao_solicitada: ['badge-exclusao', 'Conta em Exclusão']
        };
        const [classe, texto] = mapa[status] || ['badge-expirado', Agnayls.escaparHTML(status)];
        return `<span class="badge ${classe}">${texto}</span>`;
    }

    async function registrarLogAdmin(acao, uidAlvo, detalhes) {
        try {
            await Agnayls.db.collection('administracao').doc('logsAdmin').collection('entradas').add({
                admin: adminAtual ? adminAtual.email : null,
                acao,
                uidAlvo: uidAlvo || null,
                detalhes: detalhes || {},
                dataHora: firebase.firestore.Timestamp.now()
            });
        } catch (e) {
            console.error('Erro ao registrar log administrativo (a ação em si já foi aplicada normalmente):', e);
        }
    }

    async function verificarAdmin(user) {
        const usuarioDoc = await Agnayls.db.collection('usuarios').doc(user.uid).get();
        return usuarioDoc.exists && usuarioDoc.data().tipo === 'admin';
    }

    document.getElementById('btnLoginAdmin').addEventListener('click', async function () {
        try {
            const cred = await Agnayls.loginGoogle();
            const autorizado = await verificarAdmin(cred.user);
            if (!autorizado) {
                document.getElementById('avisoNegado').classList.add('show');
                await Agnayls.logout();
                return;
            }
            iniciarPainel(cred.user);
        } catch (e) {
            console.error(e);
            mostrarToast('Erro ao entrar.', 'erro');
        }
    });

    document.getElementById('btnSairAdmin').addEventListener('click', async function () {
        await Agnayls.logout();
        window.location.reload();
    });

    Agnayls.onAuthChange(async function (user) {
        if (!user) return;
        const usuarioDoc = await Agnayls.db.collection('usuarios').doc(user.uid).get();
        if (usuarioDoc.exists && usuarioDoc.data().tipo === 'admin') {
            iniciarPainel(user);
        }
    });

    async function iniciarPainel(user) {
        adminAtual = user;
        document.getElementById('telaLogin').classList.add('escondido');
        document.getElementById('telaPrincipal').classList.remove('escondido');
        document.getElementById('tabsBottomAdmin').classList.remove('escondido');
        document.getElementById('emailAdminLogado').textContent = user.email;

        configSistemaCache = await Agnayls.getConfigSistema();
        preencherFormConfig();

        await Promise.all([carregarManicures(), carregarPagamentosPendentes(), carregarContasExclusao()]);
    }

    document.querySelectorAll('.tab-btn-bottom').forEach(btn => {
        btn.addEventListener('click', function () {
            document.querySelectorAll('.tab-btn-bottom').forEach(b => b.classList.remove('ativo'));
            document.querySelectorAll('.aba').forEach(a => a.classList.remove('ativa'));
            this.classList.add('ativo');
            document.getElementById('aba-' + this.dataset.aba).classList.add('ativa');
        });
    });

    document.getElementById('btnAtualizarDados').addEventListener('click', async function () {
        const btn = this;
        const iconeOriginal = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-rotate fa-spin"></i>';
        try {
            configSistemaCache = await Agnayls.getConfigSistema();
            preencherFormConfig();
            await Promise.all([carregarManicures(), carregarPagamentosPendentes(), carregarContasExclusao()]);
            mostrarToast('Dados atualizados!', 'sucesso');
        } catch (e) {
            console.error(e);
            mostrarToast('Erro ao atualizar dados.', 'erro');
        } finally {
            btn.disabled = false;
            btn.innerHTML = iconeOriginal;
        }
    });

    function construirQueryManicures() {
        return Agnayls.db.collection('usuarios').where('tipo', '==', 'manicure').orderBy('criadoEm', 'desc');
    }

    async function buscarDetalhesManicures(usuarios) {
        const lista = [];
        for (const usuario of usuarios) {
            const uid = usuario.id;
            const [perfil, assinatura] = await Promise.all([
                Agnayls.getPerfilCompleto(uid),
                Agnayls.getAssinatura(uid)
            ]);
            const statusAcesso = Agnayls.calcularStatusAcesso(assinatura);
            lista.push({ uid, usuario, perfil, assinatura, statusAcesso });
        }
        return lista;
    }

    async function carregarManicures() {
        const container = document.getElementById('listaManicures');
        paginadorManicures = Agnayls.criarPaginador(construirQueryManicures(), 50);
        container.innerHTML = '<div class="vazio">Carregando...</div>';
        document.getElementById('paginacaoManicures').innerHTML = '';
        let usuarios;
        try {
            usuarios = await paginadorManicures.primeira();
        } catch (e) {
            console.error('Erro ao carregar manicures:', e);
            container.innerHTML = '<div class="vazio">Não foi possível carregar a lista. Tente novamente.</div>';
            return;
        }
        itensPaginaAtualManicures = await buscarDetalhesManicures(usuarios);
        renderizarListaManicures(itensPaginaAtualManicures);
        renderizarStatsPagina(itensPaginaAtualManicures);
        Agnayls.renderizarControlesPaginacao('paginacaoManicures', paginadorManicures, irParaPaginaAnteriorManicures, irParaProximaPaginaManicures);
    }

    async function irParaProximaPaginaManicures() {
        if (!paginadorManicures || !paginadorManicures.temProxima()) return;
        const usuarios = await paginadorManicures.proxima();
        itensPaginaAtualManicures = await buscarDetalhesManicures(usuarios);
        renderizarListaManicures(itensPaginaAtualManicures);
        renderizarStatsPagina(itensPaginaAtualManicures);
        Agnayls.renderizarControlesPaginacao('paginacaoManicures', paginadorManicures, irParaPaginaAnteriorManicures, irParaProximaPaginaManicures);
    }
    async function irParaPaginaAnteriorManicures() {
        if (!paginadorManicures || !paginadorManicures.temAnterior()) return;
        const usuarios = await paginadorManicures.anterior();
        itensPaginaAtualManicures = await buscarDetalhesManicures(usuarios);
        renderizarListaManicures(itensPaginaAtualManicures);
        renderizarStatsPagina(itensPaginaAtualManicures);
        Agnayls.renderizarControlesPaginacao('paginacaoManicures', paginadorManicures, irParaPaginaAnteriorManicures, irParaProximaPaginaManicures);
    }
    async function recarregarPaginaAtualManicures() {
        if (!paginadorManicures) { await carregarManicures(); return; }
        const usuarios = await paginadorManicures.recarregarAtual();
        itensPaginaAtualManicures = await buscarDetalhesManicures(usuarios);
        renderizarListaManicures(itensPaginaAtualManicures);
        renderizarStatsPagina(itensPaginaAtualManicures);
        Agnayls.renderizarControlesPaginacao('paginacaoManicures', paginadorManicures, irParaPaginaAnteriorManicures, irParaProximaPaginaManicures);
    }

    function renderizarStatsPagina(lista) {
        const ativos = lista.filter(m => m.statusAcesso.status === 'ativo').length;
        const teste = lista.filter(m => m.statusAcesso.status === 'teste_gratuito').length;
        const pendentes = lista.filter(m => m.statusAcesso.status === 'aguardando_aprovacao').length;
        const expirados = lista.filter(m => m.statusAcesso.status === 'expirado').length;

        document.getElementById('statsGrid').innerHTML = `
            <div class="stat-card"><div class="num">${ativos}</div><div class="lbl">Planos ativos (nesta página)</div></div>
            <div class="stat-card"><div class="num">${teste}</div><div class="lbl">Em teste grátis (nesta página)</div></div>
            <div class="stat-card"><div class="num">${pendentes}</div><div class="lbl">Aguardando aprovação (nesta página)</div></div>
            <div class="stat-card"><div class="num">${expirados}</div><div class="lbl">Expirados (nesta página)</div></div>
        `;
    }

    function renderizarListaManicures(lista) {
        const container = document.getElementById('listaManicures');
        if (lista.length === 0) {
            container.innerHTML = '<div class="vazio">Nenhuma manicure cadastrada ainda.</div>';
            return;
        }
        container.innerHTML = lista.map(m => {
            const nome = Agnayls.escaparHTML(m.perfil?.nomeEmpresa || m.usuario.nome || 'Sem nome');
            const email = Agnayls.escaparHTML(m.usuario.email || '');
            const foto = m.usuario.foto
                ? `<img src="${Agnayls.escaparAtributo(m.usuario.foto)}" alt="">`
                : `<i class="fa-solid fa-user"></i>`;
            const venc = m.assinatura?.vencimento ? formatarData(m.assinatura.vencimento) : '-';
            const ultimoPag = m.assinatura?.ultimoPagamento ? formatarData(m.assinatura.ultimoPagamento) : '-';
            const diasTeste = m.statusAcesso.status === 'teste_gratuito' ? `${m.statusAcesso.diasRestantesTeste}d` : '-';
            return `
            <div class="manicure-card">
                <div class="manicure-foto">${foto}</div>
                <div class="manicure-info">
                    <div class="nome">${nome}</div>
                    <div class="email">${email}</div>
                </div>
                <div class="manicure-meta">
                    <span>Cadastro: <strong>${formatarData(m.usuario.criadoEm)}</strong></span>
                    <span>Teste restante: <strong>${diasTeste}</strong></span>
                    <span>Vencimento: <strong>${venc}</strong></span>
                    <span>Último pgto: <strong>${ultimoPag}</strong></span>
                </div>
                ${badgeStatus(m.statusAcesso.status)}
                <button class="btn-detalhe" onclick="AgnaylsAdmin.abrirDetalhe('${m.uid}')">Detalhes</button>
            </div>`;
        }).join('');
    }

    window.AgnaylsAdmin = window.AgnaylsAdmin || {};

    window.AgnaylsAdmin.abrirDetalhe = function (uid) {
        const m = itensPaginaAtualManicures.find(x => x.uid === uid);
        if (!m) return;
        const nome = Agnayls.escaparHTML(m.perfil?.nomeEmpresa || m.usuario.nome || 'Sem nome');
        const responsavel = Agnayls.escaparHTML(m.perfil?.nomeResponsavel || '-');
        const email = Agnayls.escaparHTML(m.usuario.email || '-');

        document.getElementById('conteudoDetalheManicure').innerHTML = `
            <div class="linha"><span class="lbl">Nome</span><span>${nome}</span></div>
            <div class="linha"><span class="lbl">Responsável</span><span>${responsavel}</span></div>
            <div class="linha"><span class="lbl">E-mail</span><span>${email}</span></div>
            <div class="linha"><span class="lbl">Status</span><span>${badgeStatus(m.statusAcesso.status)}</span></div>
            <div class="linha"><span class="lbl">Cadastro</span><span>${formatarData(m.usuario.criadoEm)}</span></div>
            <div class="linha"><span class="lbl">Último acesso</span><span>${formatarData(m.usuario.ultimoLogin)}</span></div>
            <div class="linha"><span class="lbl">Vencimento</span><span>${formatarData(m.assinatura?.vencimento)}</span></div>
            <div class="linha"><span class="lbl">Acesso liberado</span><span>${m.assinatura?.acessoLiberado ? 'Sim' : 'Não'}</span></div>
            <div class="campo" style="margin-top:12px;">
                <label style="font-size:0.8rem; font-weight:600;">Alterar vencimento</label>
                <input type="date" id="inputNovoVencimento" style="width:100%; padding:9px; border-radius:8px; border:1px solid #e0d5da; margin-top:4px;">
            </div>
            <div class="acoes-modal">
                <button class="btn-venc" onclick="AgnaylsAdmin.salvarVencimento('${uid}')">Salvar vencimento</button>
                ${m.assinatura?.acessoLiberado
                    ? `<button class="btn-bloquear" onclick="AgnaylsAdmin.bloquearAcesso('${uid}')">Bloquear acesso</button>`
                    : `<button class="btn-liberar" onclick="AgnaylsAdmin.liberarAcesso('${uid}')">Liberar acesso</button>`}
            </div>
        `;
        document.getElementById('overlayDetalheManicure').classList.add('show');
    };

    document.getElementById('fecharDetalheManicure').addEventListener('click', () =>
        document.getElementById('overlayDetalheManicure').classList.remove('show'));

    window.AgnaylsAdmin.salvarVencimento = async function (uid) {
        const valor = document.getElementById('inputNovoVencimento').value;
        if (!valor) { mostrarToast('Escolha uma data.', 'erro'); return; }
        const data = new Date(valor + 'T23:59:59');
        const manicureAlvo = itensPaginaAtualManicures.find(x => x.uid === uid);
        const vencimentoAnterior = manicureAlvo?.assinatura?.vencimento
            ? manicureAlvo.assinatura.vencimento.toDate().toISOString()
            : null;
        await Agnayls.manicureRef(uid).collection('meta').doc('assinatura').set({
            vencimento: firebase.firestore.Timestamp.fromDate(data),
            status: 'ativo',
            acessoLiberado: true
        }, { merge: true });
        registrarLogAdmin('vencimento_alterado_manual', uid, { vencimentoAnterior, vencimentoNovo: data.toISOString() });
        mostrarToast('Vencimento atualizado!', 'sucesso');
        document.getElementById('overlayDetalheManicure').classList.remove('show');
        recarregarPaginaAtualManicures();
    };

    window.AgnaylsAdmin.bloquearAcesso = async function (uid) {
        if (!confirm('Bloquear o acesso desta conta agora? A manicure perde acesso ao painel imediatamente.')) return;
        await Agnayls.manicureRef(uid).collection('meta').doc('assinatura').set({
            acessoLiberado: false, status: 'expirado'
        }, { merge: true });
        registrarLogAdmin('acesso_bloqueado', uid, {});
        mostrarToast('Acesso bloqueado.', 'sucesso');
        document.getElementById('overlayDetalheManicure').classList.remove('show');
        recarregarPaginaAtualManicures();
    };

    window.AgnaylsAdmin.liberarAcesso = async function (uid) {
        if (!confirm('Liberar o acesso desta conta agora, com vencimento em 30 dias?')) return;
        const novoVencimento = new Date();
        novoVencimento.setDate(novoVencimento.getDate() + 30);
        await Agnayls.manicureRef(uid).collection('meta').doc('assinatura').set({
            acessoLiberado: true, status: 'ativo',
            vencimento: firebase.firestore.Timestamp.fromDate(novoVencimento)
        }, { merge: true });
        registrarLogAdmin('acesso_liberado_manual', uid, { novoVencimento: novoVencimento.toISOString() });
        mostrarToast('Acesso liberado (vencimento em 30 dias).', 'sucesso');
        document.getElementById('overlayDetalheManicure').classList.remove('show');
        recarregarPaginaAtualManicures();
    };

    async function carregarPagamentosPendentes() {
        const pendentesSnap = await Agnayls.db.collection('administracao').doc('pagamentosPendentes').collection('itens').get();
        const container = document.getElementById('listaPagamentos');

        if (pendentesSnap.empty) {
            container.innerHTML = '<div class="vazio">Nenhum pagamento aguardando aprovação.</div>';
            return;
        }

        const cartoes = [];
        comprovantesPdfCache = {};
        for (const item of pendentesSnap.docs) {
            const { uid, pagamentoId } = item.data();
            const pagamentoSnap = await Agnayls.manicureRef(uid).collection('pagamentos').doc(pagamentoId).get();
            if (!pagamentoSnap.exists) continue;
            const pagamento = pagamentoSnap.data();
            if (pagamento.status !== 'aguardando_aprovacao') continue;

            const perfil = await Agnayls.getPerfil(uid);
            const nome = Agnayls.escaparHTML(perfil?.nomeEmpresa || uid);
            const competencia = Agnayls.escaparHTML(pagamento.competencia || '');

            let blocoValorEsperado = '';
            try {
                const configuracoesConta = await Agnayls.getConfiguracoes(uid);
                if (configuracoesConta && configuracoesConta.modo === 'studio') {
                    const calculo = await Agnayls.calcularValorMensalidadeStudio(uid);
                    const bate = Math.abs(calculo.valorTotal - Number(pagamento.valor || 0)) < 0.01;
                    blocoValorEsperado = `<div style="font-size:0.78rem; margin-top:2px; color:${bate ? 'var(--verde-escuro)' : 'var(--vermelho-escuro)'}; font-weight:600;">
                        ${bate ? '✓ Confere' : '⚠️ Não confere'} — esperado: ${calculo.numProfissionaisCobraveis} profissional(is) × R$ ${calculo.valorPorFuncionaria.toFixed(2).replace('.', ',')} = R$ ${calculo.valorTotal.toFixed(2).replace('.', ',')}
                    </div>`;
                }
            } catch (e) {
                console.error('Erro ao calcular valor esperado (Studio) para', uid, e);
            }
            const comprovanteEhPdf = typeof pagamento.comprovante === 'string' &&
                /^data:application\/pdf;base64,/i.test(pagamento.comprovante);
            const comprovanteSeguro = (typeof pagamento.comprovante === 'string' &&
                /^data:(image\/(png|jpe?g|webp|gif)|application\/pdf);base64,/i.test(pagamento.comprovante))
                ? pagamento.comprovante
                : '';

            let blocoComprovante;
            if (!comprovanteSeguro) {
                blocoComprovante = `<p style="color:var(--vermelho-escuro); font-size:0.82rem;">Comprovante inválido ou corrompido — peça um novo envio.</p>`;
            } else if (comprovanteEhPdf) {
                comprovantesPdfCache[pagamentoId] = comprovanteSeguro;
                blocoComprovante = `<button type="button" class="btn-abrir-pdf" onclick="AgnaylsAdmin.abrirComprovantePdf('${pagamentoId}')"><i class="fa-solid fa-file-pdf"></i> Abrir comprovante (PDF)</button>`;
            } else {
                blocoComprovante = `<img class="comprovante-img" src="${Agnayls.escaparAtributo(comprovanteSeguro)}" onclick="AgnaylsAdmin.ampliarComprovante(this.src)">`;
            }

            cartoes.push(`
                <div class="pagamento-card">
                    <div class="pagamento-topo">
                        <span class="nome">${nome}</span>
                        <span class="valor">R$ ${Number(pagamento.valor || 0).toFixed(2).replace('.', ',')}</span>
                    </div>
                    ${blocoValorEsperado}
                    <div style="font-size:0.8rem; color:var(--texto-claro);">Competência: ${competencia} • Enviado em ${formatarData(pagamento.enviadoEm)}</div>
                    ${blocoComprovante}
                    <textarea class="obs" id="obs-${pagamentoId}" placeholder="Observações (opcional)"></textarea>
                    <div class="acoes-pagamento">
                        <button class="btn-aprovar" onclick="AgnaylsAdmin.aprovarPagamento('${uid}','${pagamentoId}')">Aprovar</button>
                        <button class="btn-rejeitar" onclick="AgnaylsAdmin.rejeitarPagamento('${uid}','${pagamentoId}')">Rejeitar</button>
                    </div>
                </div>
            `);
        }
        container.innerHTML = cartoes.length ? cartoes.join('') : '<div class="vazio">Nenhum pagamento aguardando aprovação.</div>';
    }

    window.AgnaylsAdmin.ampliarComprovante = function (src) {
        document.getElementById('imgComprovanteAmpliado').src = src;
        document.getElementById('overlayComprovanteAmpliado').classList.add('show');
    };
    document.getElementById('fecharComprovanteAmpliado').addEventListener('click', () =>
        document.getElementById('overlayComprovanteAmpliado').classList.remove('show'));

    window.AgnaylsAdmin.abrirComprovantePdf = function (pagamentoId) {
        const base64 = comprovantesPdfCache[pagamentoId];
        if (!base64) {
            mostrarToast('Não foi possível abrir o comprovante. Atualize a lista e tente novamente.', 'erro');
            return;
        }
        try {
            const partes = base64.split(',');
            const binario = atob(partes[1] || '');
            const bytes = new Uint8Array(binario.length);
            for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
            const blob = new Blob([bytes], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            window.open(url, '_blank', 'noopener');
            setTimeout(() => URL.revokeObjectURL(url), 60000);
        } catch (e) {
            console.error('Erro ao abrir comprovante em PDF:', e);
            mostrarToast('Não foi possível abrir o comprovante em PDF.', 'erro');
        }
    };

    window.AgnaylsAdmin.aprovarPagamento = async function (uid, pagamentoId) {
        if (!confirm('Aprovar este pagamento e liberar/renovar o acesso da conta?')) return;
        const obs = document.getElementById('obs-' + pagamentoId)?.value || '';
        const agora = firebase.firestore.Timestamp.now();

        let vencimentoAtual = null;
        try {
            const assinaturaSnap = await Agnayls.manicureRef(uid).collection('meta').doc('assinatura').get();
            if (assinaturaSnap.exists && assinaturaSnap.data().vencimento) {
                vencimentoAtual = assinaturaSnap.data().vencimento.toDate();
            }
        } catch (e) {
            console.error('Erro ao buscar assinatura para aprovação:', e);
        }
        const baseData = (vencimentoAtual && vencimentoAtual.getTime() > Date.now()) ? vencimentoAtual : new Date();
        const novoVencimento = new Date(baseData);
        novoVencimento.setDate(novoVencimento.getDate() + 30);

        await Agnayls.manicureRef(uid).collection('pagamentos').doc(pagamentoId).set({
            status: 'aprovado', observacoes: obs, aprovadoEm: agora, aprovadoPor: adminAtual.email
        }, { merge: true });

        await Agnayls.manicureRef(uid).collection('meta').doc('assinatura').set({
            status: 'ativo', acessoLiberado: true, ultimoPagamento: agora,
            vencimento: firebase.firestore.Timestamp.fromDate(novoVencimento)
        }, { merge: true });

        await Agnayls.db.collection('administracao').doc('pagamentosPendentes').collection('itens').doc(pagamentoId).delete();

        registrarLogAdmin('pagamento_aprovado', uid, {
            pagamentoId,
            observacoes: obs,
            vencimentoAnterior: vencimentoAtual ? vencimentoAtual.toISOString() : null,
            vencimentoNovo: novoVencimento.toISOString()
        });
        mostrarToast('Pagamento aprovado!', 'sucesso');
        carregarPagamentosPendentes();
        recarregarPaginaAtualManicures();
    };

    window.AgnaylsAdmin.rejeitarPagamento = async function (uid, pagamentoId) {
        if (!confirm('Rejeitar este pagamento? O acesso da conta será marcado como expirado.')) return;
        const obs = document.getElementById('obs-' + pagamentoId)?.value || '';
        await Agnayls.manicureRef(uid).collection('pagamentos').doc(pagamentoId).set({
            status: 'rejeitado', observacoes: obs
        }, { merge: true });
        await Agnayls.manicureRef(uid).collection('meta').doc('assinatura').set({
            status: 'expirado', acessoLiberado: false
        }, { merge: true });
        await Agnayls.db.collection('administracao').doc('pagamentosPendentes').collection('itens').doc(pagamentoId).delete();

        registrarLogAdmin('pagamento_rejeitado', uid, { pagamentoId, observacoes: obs });
        mostrarToast('Pagamento rejeitado.', 'sucesso');
        carregarPagamentosPendentes();
        recarregarPaginaAtualManicures();
    };

    async function carregarContasExclusao() {
        const snap = await Agnayls.db.collection('administracao').doc('contasPendentesExclusao').collection('contas').get();
        const container = document.getElementById('listaExclusoes');

        if (snap.empty) {
            container.innerHTML = '<div class="vazio">Nenhuma conta pendente de exclusão.</div>';
            return;
        }

        const cartoes = [];
        for (const doc of snap.docs) {
            const dados = doc.data();
            const uid = doc.id;
            const usuario = await Agnayls.getUsuario(uid);
            if (!usuario) continue;

            if (usuario.statusConta !== 'exclusao_solicitada') {
                Agnayls.db.collection('administracao').doc('contasPendentesExclusao')
                    .collection('contas').doc(uid).delete()
                    .catch((e) => console.error('Erro ao limpar ponteiro de exclusão órfão:', e));
                continue;
            }

            const diasDecorridos = Math.floor((Date.now() - dados.dataSolicitacaoExclusao.toDate()) / 86400000);
            const disponivelHoje = Date.now() >= dados.dataExclusaoPermitida.toDate().getTime();

            cartoes.push(`
                <div class="exclusao-card">
                    <div class="manicure-foto">${usuario.foto ? `<img src="${Agnayls.escaparAtributo(usuario.foto)}">` : '<i class="fa-solid fa-user"></i>'}</div>
                    <div class="manicure-info">
                        <div class="nome">${Agnayls.escaparHTML(usuario.nome || '-')}</div>
                        <div class="email">${Agnayls.escaparHTML(usuario.email || '-')}</div>
                    </div>
                    <div class="manicure-meta">
                        <span>Solicitado em: <strong>${formatarData(dados.dataSolicitacaoExclusao)}</strong></span>
                        <span>Exclusão liberada em: <strong>${formatarData(dados.dataExclusaoPermitida)}</strong></span>
                        <span>Dias decorridos: <strong>${diasDecorridos}</strong></span>
                    </div>
                    <button class="btn-reativar" onclick="AgnaylsAdmin.reativarConta('${uid}')">Reativar Conta</button>
                    <button class="btn-excluir-perm" ${disponivelHoje ? '' : 'disabled title="Ainda dentro do período de retenção de 90 dias"'} onclick="AgnaylsAdmin.excluirPermanente('${uid}')">Excluir Permanentemente</button>
                </div>
            `);
        }
        container.innerHTML = cartoes.length ? cartoes.join('') : '<div class="vazio">Nenhuma conta pendente de exclusão.</div>';
    }

    window.AgnaylsAdmin.reativarConta = async function (uid) {
        await Agnayls.db.collection('usuarios').doc(uid).set({ statusConta: 'ativa' }, { merge: true });
        await Agnayls.manicureRef(uid).collection('meta').doc('assinatura').set({
            dataSolicitacaoExclusao: null, dataExclusaoPermitida: null
        }, { merge: true });
        await Agnayls.db.collection('administracao').doc('contasPendentesExclusao').collection('contas').doc(uid).delete();
        registrarLogAdmin('conta_reativada_pelo_admin', uid, {});
        mostrarToast('Conta reativada!', 'sucesso');
        carregarContasExclusao();
        recarregarPaginaAtualManicures();
    };

    window.AgnaylsAdmin.excluirPermanente = async function (uid) {
        let resumoContaExcluida = { uid };
        try {
            const usuarioSnap = await Agnayls.db.collection('usuarios').doc(uid).get();
            if (usuarioSnap.exists) {
                resumoContaExcluida.email = usuarioSnap.data().email || null;
                resumoContaExcluida.nome = usuarioSnap.data().nome || null;
            }
        } catch (e) {
            console.error('Erro ao buscar dados da conta antes da exclusão (log ficará incompleto):', e);
        }

        // F5: exclusão definitiva é irreversível — confirm() simples é contornável
        // por script e fácil de disparar sem realmente ler o aviso. Exige digitar
        // o e-mail exato da conta.
        const emailAlvo = resumoContaExcluida.email;
        if (!emailAlvo) {
            mostrarToast('Não foi possível confirmar o e-mail desta conta. Atualize a lista e tente novamente.', 'erro');
            return;
        }
        const digitado = prompt(
            'Esta ação é IRREVERSÍVEL e remove todos os dados desta manicure ' +
            '(agendamentos, financeiro, clientes, profissionais).\n\n' +
            'Para confirmar, digite exatamente o e-mail da conta:\n' + emailAlvo
        );
        if (digitado === null) return;
        if (digitado.trim().toLowerCase() !== emailAlvo.toLowerCase()) {
            mostrarToast('E-mail digitado não confere. Exclusão cancelada.', 'erro');
            return;
        }

        // F5: exige reautenticação recente do próprio admin antes de uma ação
        // desse impacto — reduz o risco de a sessão já aberta ser usada por
        // automação/script sem uma interação real do admin naquele momento.
        try {
            await Agnayls.auth.currentUser.reauthenticateWithPopup(new firebase.auth.GoogleAuthProvider());
        } catch (e) {
            console.error('Reautenticação falhou ou foi cancelada:', e);
            mostrarToast('Reautenticação necessária para excluir. Tente novamente.', 'erro');
            return;
        }

        try {
            await Agnayls.excluirContaPermanentemente(uid);
        } catch (e) {
            console.error('Erro ao excluir conta permanentemente:', e);
            mostrarToast('Erro ao excluir a conta. Tente novamente.', 'erro');
            return;
        }
        registrarLogAdmin('conta_excluida_permanentemente', uid, resumoContaExcluida);
        mostrarToast('Conta excluída permanentemente.', 'sucesso');
        carregarContasExclusao();
        recarregarPaginaAtualManicures();
    };

    function preencherFormConfig() {
        document.getElementById('cfgMensalidade').value = configSistemaCache.mensalidade;
        document.getElementById('cfgValorFuncionariaStudio').value = configSistemaCache.valorFuncionariaStudio || 0;
        document.getElementById('cfgChavePix').value = configSistemaCache.chavePix;
        document.getElementById('cfgWhatsapp').value = Agnayls.mascararCelular(configSistemaCache.whatsappFinanceiro);
        document.getElementById('cfgDiasTeste').value = configSistemaCache.diasTeste;
        document.getElementById('cfgManutencao').checked = !!configSistemaCache.manutencao;
    }
    Agnayls.aplicarMascaraCelular(document.getElementById('cfgWhatsapp'));

    document.getElementById('formConfigSistema').addEventListener('submit', async function (e) {
        e.preventDefault();
        const novaConfig = {
            mensalidade: parseFloat(document.getElementById('cfgMensalidade').value) || 0,
            valorFuncionariaStudio: parseFloat(document.getElementById('cfgValorFuncionariaStudio').value) || 0,
            chavePix: document.getElementById('cfgChavePix').value.trim(),
            whatsappFinanceiro: document.getElementById('cfgWhatsapp').value.replace(/\D/g, ''),
            diasTeste: parseInt(document.getElementById('cfgDiasTeste').value) || 15,
            manutencao: document.getElementById('cfgManutencao').checked
        };
        await Agnayls.setConfigSistema(novaConfig);
        configSistemaCache = { ...configSistemaCache, ...novaConfig };
        mostrarToast('Configurações salvas!', 'sucesso');
    });
})();