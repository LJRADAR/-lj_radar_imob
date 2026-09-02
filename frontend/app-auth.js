'use strict';

(function(){
  const cfg = window.LJI_CONFIG || {};
  const overlay = document.getElementById('ljiAuthOverlay');
  const emailEl = document.getElementById('ljiAuthEmail');
  const passEl = document.getElementById('ljiAuthPassword');
  const loginBtn = document.getElementById('ljiAuthLogin');
  const errorEl = document.getElementById('ljiAuthError');
  const successEl = document.getElementById('ljiAuthSuccess');
  const forgotEl = document.getElementById('ljiForgotPassword');

  if(!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || cfg.MODE !== 'supabase' || !window.supabase){
    overlay?.classList.remove('hidden');
    if(errorEl){errorEl.textContent='A configuração de acesso está indisponível. O painel permaneceu bloqueado.';errorEl.classList.add('show')}
    return;
  }

  const authClient = window.LJI_getSupabaseClient();
  if(!authClient){
    overlay?.classList.remove('hidden');
    if(errorEl){errorEl.textContent='Não foi possível iniciar o acesso seguro. O painel permaneceu bloqueado.';errorEl.classList.add('show')}
    return;
  }

  function showError(msg){
    errorEl.textContent = msg;
    errorEl.classList.add('show');
  }

  function showSuccess(msg){
    successEl.textContent = msg;
    successEl.classList.add('show');
    errorEl.classList.remove('show');
  }

  async function forgotPassword(){
    const email = (emailEl.value || '').trim();

    if(!email){
      showError('Digite seu e-mail primeiro.');
      emailEl.focus();
      return;
    }

    forgotEl.style.pointerEvents = 'none';
    forgotEl.textContent = 'Enviando...';
    errorEl.classList.remove('show');

    try{
      const redirectTo = window.location.origin;
      const {error} = await authClient.auth.resetPasswordForEmail(email,{redirectTo});
      if(error) throw error;

      showSuccess('E-mail de recuperação enviado. Abra a mensagem e clique no link para definir uma nova senha.');
    }catch(e){
      console.error('Recuperação de senha:',e);
      let msg='Não foi possível enviar o e-mail de recuperação.';
      const raw=String(e?.message||'').toLowerCase();
      if(raw.includes('rate')) msg='Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.';
      else if(raw.includes('redirect')) msg='O endereço do LJ Radar Imob precisa estar autorizado no Supabase.';
      else if(e?.message) msg += ' '+e.message;
      showError(msg);
    }finally{
      forgotEl.style.pointerEvents = '';
      forgotEl.textContent = 'Esqueceu sua senha?';
    }
  }
  async function verifyMembership(userId){
    const {data, error} = await authClient
      .from('lji_workspace_members')
      .select('role,is_active,permissions')
      .eq('workspace_id', cfg.WORKSPACE_ID)
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle();

    if(error) throw error;
    return data;
  }

  async function login(){
    const email = (emailEl.value || '').trim();
    const password = passEl.value || '';

    if(!email || !password){
      showError('Preencha e-mail e senha.');
      return;
    }

    loginBtn.disabled = true;
    loginBtn.textContent = 'Entrando...';
    errorEl.classList.remove('show');

    const {data, error} = await authClient.auth.signInWithPassword({email, password});

    if(error){
      const raw=String(error.message||'').toLowerCase();
      if(raw.includes('invalid login credentials')) showError('Senha incorreta ou e-mail inválido. Se necessário, use “Esqueceu sua senha?”.');
      else if(raw.includes('email not confirmed')) showError('Este e-mail ainda não foi confirmado no Supabase.');
      else showError('Não foi possível entrar: '+(error.message||'erro de autenticação.'));
      loginBtn.disabled = false;
      loginBtn.textContent = 'Entrar';
      return;
    }

    try{
      const member = await verifyMembership(data.user.id);
      if(!member){
        await authClient.auth.signOut();
        showError('Este usuário não tem acesso ao LJ Radar Imob.');
        loginBtn.disabled = false;
        loginBtn.textContent = 'Entrar';
        return;
      }
      window.location.reload();
    }catch(e){
      console.error(e);
      await authClient.auth.signOut();
      showError('Não foi possível validar a permissão do usuário.');
      loginBtn.disabled = false;
      loginBtn.textContent = 'Entrar';
    }
  }


  const recoveryOverlay = document.getElementById('ljiRecoveryOverlay');
  const newPasswordEl = document.getElementById('ljiNewPassword');
  const confirmPasswordEl = document.getElementById('ljiConfirmPassword');
  const savePasswordBtn = document.getElementById('ljiSavePassword');
  const recoveryErrorEl = document.getElementById('ljiRecoveryError');
  const recoverySuccessEl = document.getElementById('ljiRecoverySuccess');

  function showRecoveryError(msg){
    recoverySuccessEl.classList.remove('show');
    recoveryErrorEl.textContent = msg;
    recoveryErrorEl.classList.add('show');
  }

  function showRecoverySuccess(msg){
    recoveryErrorEl.classList.remove('show');
    recoverySuccessEl.textContent = msg;
    recoverySuccessEl.classList.add('show');
  }

  function openRecovery(){
    overlay.classList.add('hidden');
    recoveryOverlay.classList.remove('hidden');
    window.history.replaceState(null,'',window.location.origin+window.location.pathname);
    setTimeout(()=>newPasswordEl.focus(), 50);
  }

  async function saveNewPassword(){
    const p1 = newPasswordEl.value || '';
    const p2 = confirmPasswordEl.value || '';

    if(p1.length < 8){
      showRecoveryError('A nova senha precisa ter pelo menos 8 caracteres.');
      return;
    }
    if(p1 !== p2){
      showRecoveryError('As duas senhas não são iguais.');
      return;
    }

    savePasswordBtn.disabled = true;
    savePasswordBtn.textContent = 'Salvando...';

    try{
      const {error} = await authClient.auth.updateUser({password:p1});
      if(error) throw error;

      showRecoverySuccess('Senha alterada com sucesso.');
      newPasswordEl.value = '';
      confirmPasswordEl.value = '';

      setTimeout(async ()=>{
        await authClient.auth.signOut();
        recoveryOverlay.classList.add('hidden');
        overlay.classList.remove('hidden');
        errorEl.classList.remove('show');
        if(successEl) successEl.classList.remove('show');
        emailEl.focus();
      }, 1200);
    }catch(e){
      console.error(e);
      showRecoveryError(e?.message || 'Não foi possível alterar a senha.');
    }finally{
      savePasswordBtn.disabled = false;
      savePasswordBtn.textContent = 'Salvar nova senha';
    }
  }

  savePasswordBtn.addEventListener('click', saveNewPassword);
  confirmPasswordEl.addEventListener('keydown', function(e){
    if(e.key === 'Enter') saveNewPassword();
  });

  // Recuperação robusta: trata links do Supabase com access_token no hash
  // e também links com token_hash na query string.
  async function handleRecoveryFromUrl(){
    try{
      const search = new URLSearchParams(window.location.search);
      const hash = new URLSearchParams((window.location.hash || '').replace(/^#/,''));

      const type = (search.get('type') || hash.get('type') || '').toLowerCase();
      const accessToken = hash.get('access_token');
      const refreshToken = hash.get('refresh_token');
      const tokenHash = search.get('token_hash');

      // Fluxo implícito: #access_token=...&refresh_token=...&type=recovery
      if(type === 'recovery' && accessToken && refreshToken){
        const {error} = await authClient.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken
        });
        if(error) throw error;
        openRecovery();
        return true;
      }

      // Fluxo PKCE / template customizado: ?token_hash=...&type=recovery
      if(type === 'recovery' && tokenHash){
        const {error} = await authClient.auth.verifyOtp({
          token_hash: tokenHash,
          type: 'recovery'
        });
        if(error) throw error;
        openRecovery();
        return true;
      }

      // Caso o SDK já tenha processado a URL antes deste script.
      if(type === 'recovery'){
        const {data, error} = await authClient.auth.getSession();
        if(error) throw error;
        if(data?.session){
          openRecovery();
          return true;
        }
      }
    }catch(e){
      console.error('Recuperação de senha:', e);
      showRecoveryError(e?.message || 'O link de recuperação não pôde ser validado. Solicite um novo link.');
      openRecovery();
      return true;
    }
    return false;
  }

  authClient.auth.onAuthStateChange((event)=>{
    if(event === 'PASSWORD_RECOVERY') openRecovery();
  });

  handleRecoveryFromUrl();

  loginBtn.addEventListener('click', login);
  forgotEl.addEventListener('click', forgotPassword);
  passEl.addEventListener('keydown', function(e){
    if(e.key === 'Enter') login();
  });

  authClient.auth.getSession().then(async ({data,error})=>{
    if(error)throw error;
    const params = (window.location.search + window.location.hash).toLowerCase();
    const isRecoveryUrl = params.includes('type=recovery') || params.includes('access_token=') || params.includes('token_hash=');
    if(isRecoveryUrl)return;
    if(!data.session){overlay.classList.remove('hidden');return}
    const member=await verifyMembership(data.session.user.id);
    if(!member){await authClient.auth.signOut();showError('Este usuário não tem acesso ao LJ Radar Imob.');overlay.classList.remove('hidden');return}
    overlay.classList.add('hidden');
  }).catch(error=>{
    console.error('Validação da sessão:',error);
    showError('Não foi possível validar a sessão. O painel permaneceu bloqueado.');
    overlay.classList.remove('hidden');
  });
})();
