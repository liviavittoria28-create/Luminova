/* LumiNova — perfil cósmico (design novo) + Supabase como fonte única dos dados. */
(() => {
  "use strict";
  const $ = (s, root=document) => root.querySelector(s);
  const $$ = (s, root=document) => [...root.querySelectorAll(s)];
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
  const cfg = window.LUMINOVA_SUPABASE_CONFIG;
  let sb, user, profile;
  // cores "de fábrica" vêm do tema atual (claro/escuro); só o que a pessoa escolheu fica salvo
  const TD = () => (window.LUMI_THEME ? window.LUMI_THEME.defaults() : { page: "#dff3ff", accent: "#0d76c9", card: "#ffffff", text: "#0d3552" });
  const SWATCHES = ["#f5f6fa", "#ffffff", "#e8c88a", "#fde68a", "#fb923c", "#fca5a5", "#f9a8d4", "#f472b6", "#c4b5fd", "#a5b4fc", "#818cf8", "#7dd3fc", "#38bdf8", "#86efac", "#34d399", "#d4d4d8"];
  const MIN_CONTRAST = 4.5;
  const toast = (msg) => {
    const el = $("#toast");
    if (!el) { console.log(msg); return; }
    el.textContent = msg; el.classList.add("show");
    clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove("show"), 3200);
  };
  const settings = () => profile?.profile_settings || {};
  // devolve a cor só se a pessoa mudou em relação ao padrão do tema
  const custom = (sel, key) => { const v = document.querySelector(sel)?.value; return v && v.toLowerCase() !== TD()[key].toLowerCase() ? v : null; };
  const showModal = (open) => {
    const modal=$("#settingsModal"); if (!modal) return;
    modal.classList.toggle("open", open); modal.setAttribute("aria-hidden", String(!open));
  };
  window.addEventListener("luminova:theme", () => {
    const st=settings();
    [["#pageBgInput","background","page"],["#accentInput","accent","accent"],["#cardBgInput","card","card"],["#textColorInput","textColor","text"]].forEach(([sel,k,d])=>{
      const el=document.querySelector(sel); if(el && !st[k]){ el.value=TD()[d]; el.dispatchEvent(new Event("input",{bubbles:true})); }
    });
  });
  const applyTheme = () => {
    const st=settings();
    const R=document.documentElement.style, setOrClear=(k,v)=>v?R.setProperty(k,v):R.removeProperty(k);
    setOrClear("--lumi-page",st.background); setOrClear("--background",st.background);
    setOrClear("--lumi-accent",st.accent); setOrClear("--primary",st.accent); setOrClear("--ring",st.accent);
    setOrClear("--lumi-card",st.card);
    setOrClear("--lumi-on-accent", st.accent && window.LUMI_THEME ? LUMI_THEME.onAccent(st.accent) : "");
    document.body.style.background=st.background||"";
    setOrClear("--lumi-text",st.textColor);
    document.body.classList.toggle("lumi-has-text", !!st.textColor);
    $$("[data-widget]").forEach(el => el.hidden = (st.hiddenWidgets || []).includes(el.dataset.widget));
    $$("[data-widget-toggle]").forEach(el => el.checked = !(st.hiddenWidgets || []).includes(el.dataset.widgetToggle));
    // Os cartões do layout novo usam classes de fundo estáticas; aplicamos a cor salva sem alterar a estrutura visual.
    $$("[class]").filter(el => [...el.classList].some(c => c.includes("rgba(12,16,36,.9)"))).forEach(el => { el.style.backgroundColor = st.card || ""; });
    const style=st.coverStyle || "cosmic";
    const covers={
      cosmic:"radial-gradient(ellipse 60% 30% at 20% 18%,rgba(255,255,255,.85),transparent 70%),radial-gradient(ellipse 50% 25% at 78% 28%,rgba(255,255,255,.7),transparent 70%),radial-gradient(ellipse 120% 40% at 30% 118%,#7fdc3e 0 50%,#3fae2a 66%,transparent 67%),linear-gradient(180deg,#2f9cf0,#7fcdfa 70%,#d6f0ff)",
      ocean:"radial-gradient(circle at 25% 30%,rgba(255,255,255,.55),transparent 40%),radial-gradient(circle at 75% 70%,rgba(80,240,220,.55),transparent 50%),linear-gradient(160deg,#4fd8ff,#1479d8 55%,#0a3f94)",
      sunset:"radial-gradient(circle at 70% 30%,rgba(255,255,255,.8),transparent 28%),linear-gradient(170deg,#ffd27a,#ff8fb4 55%,#8f7bff)",
      forest:"radial-gradient(circle at 78% 22%,rgba(255,255,255,.75),transparent 28%),radial-gradient(ellipse 120% 45% at 30% 120%,#2f9d3a 0 50%,transparent 51%),linear-gradient(180deg,#b9f06a,#4cd0a0 60%,#19a9c6)",
    };
    const layer=$(".lumi-cover-drift");
    if (layer && !profile?.cover_url) layer.style.background=covers[style] || covers.cosmic;
  };
  function applyCoverMessage(message, position="top-left") {
    const el=$("#coverMessage");
    if(!el)return;
    const positions={
      "top-left":{left:"24px",right:"auto",top:"20px",bottom:"auto",transform:"none",textAlign:"left"},
      "top-center":{left:"50%",right:"auto",top:"20px",bottom:"auto",transform:"translateX(-50%)",textAlign:"center"},
      "top-right":{left:"auto",right:"24px",top:"20px",bottom:"auto",transform:"none",textAlign:"right"},
      "center-left":{left:"24px",right:"auto",top:"50%",bottom:"auto",transform:"translateY(-50%)",textAlign:"left"},
      "center":{left:"50%",right:"auto",top:"50%",bottom:"auto",transform:"translate(-50%,-50%)",textAlign:"center"},
      "center-right":{left:"auto",right:"24px",top:"50%",bottom:"auto",transform:"translateY(-50%)",textAlign:"right"},
      "bottom-left":{left:"24px",right:"auto",top:"auto",bottom:"20px",transform:"none",textAlign:"left"},
      "bottom-center":{left:"50%",right:"auto",top:"auto",bottom:"20px",transform:"translateX(-50%)",textAlign:"center"},
      "bottom-right":{left:"auto",right:"24px",top:"auto",bottom:"20px",transform:"none",textAlign:"right"}
    };
    const p=positions[position]||positions["top-left"];
    Object.assign(el.style,p);
    el.textContent=message||"";
    el.hidden=!message;
  }
  const renderProfile = () => {
    if (!profile) return;
    const meta=user?.user_metadata || {};
    const first=meta.first_name || meta.nome || meta.name || "";
    const last=meta.last_name || meta.sobrenome || "";
    const full=[first,last].filter(Boolean).join(" ").trim() || meta.full_name || "";
    const name=profile.display_name || full || user?.email?.split("@")[0] || "Novo usuário";
    const handle=profile.username || meta.username || meta.nickname || "";
    const bio=profile.bio || "";
    [["#hero-name",name],["#sidebar-name",name],["#hero-handle",handle || "seu-universo"],
      ["#hero-bio",bio || "Adicione uma bio para apresentar seu universo."],
      ["#hero-location",profile.location || ""],["#nameInput",name],["#handleInput",handle],["#bioInput",bio]
    ].forEach(([sel,val])=>{const el=$(sel);if(el){if("value" in el && /Input$/.test(sel))el.value=val;else el.textContent=val;}});
    const avatar=profile.avatar_url;
    ["#hero-avatar","#sidebar-avatar","#composer-avatar"].forEach(sel=>{
      const el=$(sel); if(!el)return;
      if(avatar && el.tagName==="IMG"){el.src=avatar;el.alt=`Foto de ${name}`;}
      else if(avatar){el.style.backgroundImage=`url("${avatar}")`;el.style.backgroundSize="cover";el.style.backgroundPosition="center";el.textContent="";}
      else if(el.tagName!=="IMG")el.textContent=(name.trim()[0]||"✦").toUpperCase();
    });
    const cover=$("#cover");
    const coverLayer=cover?.querySelector(".lumi-cover-drift");
    if(cover && coverLayer && profile.cover_url){
      // A camada decorativa fica acima do fundo do container; a imagem precisa ser aplicada nela.
      coverLayer.style.backgroundImage=`linear-gradient(90deg,#090a1840,#090a1820),url("${profile.cover_url}")`;
      coverLayer.style.backgroundSize="cover";
      coverLayer.style.backgroundPosition="center";
      coverLayer.style.backgroundRepeat="no-repeat";
      coverLayer.style.opacity="1";
    } else if(coverLayer && !profile?.cover_url){
      coverLayer.style.backgroundSize="cover";
      coverLayer.style.backgroundPosition="center";
    }
    const st=settings();
    const values={"#pageBgInput":st.background||TD().page,"#accentInput":st.accent||TD().accent,"#cardBgInput":st.card||TD().card,"#coverStyle":st.coverStyle||"cosmic","#coverMessageInput":st.coverMessage??"Minha jornada, minha evolução ✦","#coverMessagePosition":st.coverMessagePosition||"top-left","#textColorInput":st.textColor||TD().text};
    Object.entries(values).forEach(([sel,val])=>{const el=$(sel);if(el)el.value=val;});
    applyCoverMessage(st.coverMessage??"Minha jornada, minha evolução ✦",st.coverMessagePosition||"top-left");
    const interests=$("#hero-interests"); if(interests) interests.textContent=(profile.interests||[]).join(" · ");
    applyTheme();
  };
  async function ensureProfile() {
    const {data,error}=await sb.from("profiles").select("*").eq("id",user.id).maybeSingle();
    if(error) throw error;
    const md=user.user_metadata||{};
    const display=[md.first_name||md.nome||md.name||"",md.last_name||md.sobrenome||""].filter(Boolean).join(" ").trim() || md.full_name || user.email?.split("@")[0] || "Novo usuário";
    const username=(md.username||md.nickname||"").replace(/^@/,"") || null;
    if(data){
      profile=data;
      const patch={};
      if((!profile.display_name || profile.display_name==="Novo usuário") && display)patch.display_name=display;
      if(!profile.username && username && /^[a-zA-Z0-9_.-]{3,30}$/.test(username))patch.username=username;
      if(Object.keys(patch).length) {
        const updated=await sb.from("profiles").update(patch).eq("id",user.id).select("*").single();
        if(!updated.error)profile=updated.data;
      }
      return;
    }
    const payload={id:user.id,display_name:display,bio:"",username};
    const {data:created,error:insertError}=await sb.from("profiles").insert(payload).select("*").single();
    if(insertError) {
      // Trigger can create the row between select and insert; re-read before failing.
      const again=await sb.from("profiles").select("*").eq("id",user.id).maybeSingle();
      if(again.data){profile=again.data;return;}
      throw insertError;
    }
    profile=created;
  }
  async function saveProfile(patch={}, settingsPatch=null) {
    const updates={...patch};
    if(settingsPatch) updates.profile_settings={...settings(),...settingsPatch};
    updates.updated_at=new Date().toISOString();
    const {data,error}=await sb.from("profiles").update(updates).eq("id",user.id).select("*").single();
    if(error) throw error;
    profile=data; renderProfile();
  }
  async function uploadImage(file, folder) {
    if(!file)return null;
    if(!file.type || !file.type.startsWith("image/"))throw Error("Selecione um arquivo PNG, JPG, WEBP ou GIF.");
    if(file.size>5*1024*1024)throw Error("A imagem deve ter no máximo 5 MB.");
    if(!user?.id)throw Error("Sua sessão expirou. Entre novamente para alterar a imagem.");
    const mimeExt={"image/jpeg":"jpg","image/png":"png","image/webp":"webp","image/gif":"gif"};
    const ext=mimeExt[file.type] || (file.name.split(".").pop()||"jpg").replace(/[^a-zA-Z0-9]/g,"").slice(0,8)||"jpg";
    const path=`${user.id}/${folder}/${Date.now()}-${Math.random().toString(36).slice(2,8)}.${ext}`;
    const {error}=await sb.storage.from("profile-media").upload(path,file,{upsert:false,contentType:file.type});
    if(error)throw error;
    const {data}=sb.storage.from("profile-media").getPublicUrl(path);
    return data.publicUrl;
  }
  async function countQuery(query) {
    const r=await query; if(r.error) { console.warn("LumiNova metrics:",r.error.message); return 0; }
    return r.count||0;
  }
  const BRANCH = {origem:["ORIGEM","#e8c88a"],criacao:["CRIAÇÃO","#c084fc"],colaboracao:["COLABORAÇÃO","#60a5fa"],comunidade:["COMUNIDADE","#4ade80"],exploracao:["EXPLORAÇÃO","#f472b6"]};
  const METRIC_LABEL = {posts:"publicações",comments:"comentários",communities_joined:"comunidades",communities_created:"comunidades criadas",following:"pessoas seguidas",followers:"seguidores",profile_complete:"perfil completo",none:""};
  let skillState = {nodes:[],unlocked:new Set(),xp:0,metrics:{},selected:"centelha"};
  async function metricsFor(){
    const [posts,comments,joined,created,followers,following]=await Promise.all([
      countQuery(sb.from("posts").select("id",{count:"exact",head:true}).eq("author_id",user.id).is("deleted_at",null)),
      countQuery(sb.from("comments").select("id",{count:"exact",head:true}).eq("author_id",user.id).is("deleted_at",null)),
      countQuery(sb.from("community_members").select("community_id",{count:"exact",head:true}).eq("user_id",user.id).eq("status","active")),
      countQuery(sb.from("communities").select("id",{count:"exact",head:true}).eq("owner_id",user.id)),
      countQuery(sb.from("follows").select("follower_id",{count:"exact",head:true}).eq("followed_id",user.id)),
      countQuery(sb.from("follows").select("followed_id",{count:"exact",head:true}).eq("follower_id",user.id))
    ]);
    return {posts,comments,communities_joined:joined,communities_created:created,followers,following,profile_complete:(profile.bio&&profile.display_name!=="Novo usuário")?1:0};
  }
  function nodeStatus(n){
    const {unlocked,xp,metrics}=skillState;
    if(unlocked.has(n.node_key))return "done";
    const prereq=(n.requires||[]).every(r=>unlocked.has(r));
    if(!prereq)return "locked";
    const metricOk=n.metric==="none"||(metrics[n.metric]||0)>=n.metric_min;
    if(xp>=n.xp_required&&metricOk)return "available";
    return "progress";
  }
  const STATUS_UI={done:["Concluído","#4ade80"],available:["Disponível","#e8c88a"],progress:["Em progresso","#60a5fa"],locked:["Bloqueado","#5a6488"]};
  function drawSkillTree(){
    const host=$("#skillTreeSection");if(!host)return;
    const {nodes,xp,metrics}=skillState;
    const level=Math.floor(xp/100)+1;
    const byKey=Object.fromEntries(nodes.map(n=>[n.node_key,n]));
    const sel=byKey[skillState.selected]||nodes[0];
    const edges=nodes.flatMap(n=>(n.requires||[]).map(r=>byKey[r]?`<line x1="${byKey[r].pos_x}" y1="${byKey[r].pos_y}" x2="${n.pos_x}" y2="${n.pos_y}" stroke="${skillState.unlocked.has(r)?"#4ade8088":"#333d59"}" stroke-width="1.5" stroke-dasharray="${skillState.unlocked.has(r)?"0":"4 5"}"/>`:""));
    const svgNodes=nodes.map(n=>{const st=nodeStatus(n),col=STATUS_UI[st][1];
      return `<g class="cursor-pointer" tabindex="0" role="button" data-skill-node="${esc(n.node_key)}" aria-label="${esc(n.name)} — ${STATUS_UI[st][0]}" style="outline:none">
        <circle cx="${n.pos_x}" cy="${n.pos_y}" r="${n.node_key===skillState.selected?34:30}" fill="#0c1024" stroke="${col}" stroke-width="${n.node_key===skillState.selected?3:2}" ${st==="locked"?'stroke-dasharray="4 4"':""}/>
        <text x="${n.pos_x}" y="${n.pos_y+5}" text-anchor="middle" font-size="15" fill="${col}">${st==="done"?"✓":"✦"}</text>
        <text x="${n.pos_x}" y="${n.pos_y+52}" text-anchor="middle" font-size="11" fill="${st==="locked"?"#5a6488":"#dfe3f3"}" stroke="#060914" stroke-width="3" paint-order="stroke" class="font-mono">${esc(n.name)}</text></g>`}).join("");
    const labels=[["CRIAÇÃO",145,40],["COLABORAÇÃO",615,40],["COMUNIDADE",145,590],["EXPLORAÇÃO",615,590]].map(([t,x,y])=>`<text x="${x}" y="${y}" text-anchor="middle" font-size="10" letter-spacing="3" fill="#5a6488" opacity="0.7" class="font-mono">${t}</text>`).join("");
    const st=sel?nodeStatus(sel):"locked",[stLabel,stColor]=STATUS_UI[st];
    const have=sel&&sel.metric!=="none"?(metrics[sel.metric]||0):0;
    const reqs=sel?[...(sel.xp_required>0?[`XP: ${Math.min(xp,sel.xp_required)}/${sel.xp_required}`]:[]),...(sel.metric!=="none"?[`${METRIC_LABEL[sel.metric]}: ${Math.min(have,sel.metric_min)}/${sel.metric_min}`]:[]),...((sel.requires||[]).map(r=>`${skillState.unlocked.has(r)?"✓":"○"} ${byKey[r]?.name||r}`))]:[];
    host.innerHTML=`
      <div class="mb-5 flex flex-wrap items-end justify-between gap-3"><div class="min-w-0">
        <span class="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--lumi-accent)]">MEU DESENVOLVIMENTO</span>
        <h2 class="mt-1 font-heading text-2xl tracking-tight text-[#f5f6fa]">Skill Tree <span class="text-[var(--lumi-accent)]">✦</span></h2>
        <p class="mt-1 text-sm text-muted-foreground">Sua constelação · <span id="tree-xp-label">${xp} XP · Nível ${level}</span> · ${skillState.unlocked.size}/${nodes.length} acesas</p></div></div>
      <div class="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2">${Object.values(STATUS_UI).map(([l,c])=>`<span class="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground"><span aria-hidden="true" class="inline-block size-2 rounded-full" style="background:${c}"></span>${l}</span>`).join("")}</div>
      <div class="flex flex-col gap-5">
        <div class="min-w-0 flex-1 overflow-x-auto border border-white/8 bg-[#060914] p-2" data-testid="skill-tree-container">
          <svg viewBox="0 0 760 620" class="h-auto w-full" style="min-width:520px" role="group" aria-label="Mapa da Skill Tree">${labels}${edges.join("")}${svgNodes}</svg></div>
        <aside data-testid="skill-node-detail" class="border border-white/8 bg-[#090d1f] p-5" aria-live="polite">
          ${sel?`<span class="inline-block border px-2 py-0.5 font-mono text-[9px] uppercase tracking-widest" style="color:${stColor};border-color:${stColor}">${stLabel}</span>
          <h3 class="mt-2 font-heading text-xl tracking-tight text-[#f5f6fa]">${esc(sel.name)}</h3>
          <p class="mt-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground"><span aria-hidden="true" class="inline-block size-2 rounded-full" style="background:${(BRANCH[sel.branch]||[])[1]||"#e8c88a"}"></span>${(BRANCH[sel.branch]||[sel.branch])[0]}</p>
          <p class="mt-2 text-sm leading-relaxed text-muted-foreground">${esc(sel.description)}</p>
          <ul class="mt-3 space-y-1 text-xs text-[#dfe3f3]">${reqs.map(r=>`<li>${esc(r)}</li>`).join("")}</ul>
          <button type="button" id="claimSkill" data-skill-claim="${esc(sel.node_key)}" ${st==="available"?"":"disabled"} class="mt-4 w-full inline-flex items-center justify-center h-9 px-2.5 text-sm font-medium bg-[var(--lumi-accent)] text-[#141005] ${st==="available"?"":"opacity-50 cursor-not-allowed"}">${st==="done"?"Já resgatada ✓":st==="available"?`Resgatar +${sel.xp_reward} XP ✦`:"Requisitos pendentes"}</button>
          <p class="mt-4 font-mono text-[9px] uppercase leading-relaxed tracking-widest text-muted-foreground">+10 XP por publicação · +3 XP por comentário</p>`:"<p class='text-sm text-muted-foreground'>Sem habilidades cadastradas. Execute a Migracao-2-LUMINOVA.sql.</p>"}
        </aside></div>`;
    host.querySelectorAll("[data-skill-node]").forEach(g=>{
      const pick=()=>{skillState.selected=g.dataset.skillNode;drawSkillTree();};
      g.addEventListener("click",pick);g.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();pick();}});
    });
    $("#claimSkill")?.addEventListener("click",async e=>{
      const key=e.currentTarget.dataset.skillClaim;e.currentTarget.disabled=true;
      const {data,error}=await sb.rpc("luminova_unlock_skill",{p_node:key});
      if(error){toast(error.message);e.currentTarget.disabled=false;return;}
      toast(data?.already?"Habilidade já resgatada.":`Habilidade acesa! +${data.xp_reward} XP ✦`);
      await renderSkillTree();
    });
  }
  async function renderSkillTree() {
    const [metrics,nodesRes,unlockedRes,progRes]=await Promise.all([
      metricsFor(),
      sb.from("skill_nodes").select("*").order("xp_required"),
      sb.from("profile_skills").select("node_key").eq("user_id",user.id),
      sb.from("profile_progress").select("xp,level").eq("user_id",user.id).maybeSingle()
    ]);
    if(nodesRes.error)console.warn("skill_nodes:",nodesRes.error.message);
    const xp=progRes.data?.xp||0, level=Math.floor(xp/100)+1, progress=xp%100;
    skillState={...skillState,nodes:nodesRes.data||[],unlocked:new Set((unlockedRes.data||[]).map(x=>x.node_key)),xp,metrics};
    const {posts,comments,communities_joined:joined,followers,following}=metrics;
    const set=(id,val)=>{const el=$(id);if(el)el.textContent=String(val);};
    set("#stat-communities",joined);set("#stat-connections",followers);set("#stat-xp",xp);
    set("#badge-level-value",level);set("#journey-level",level);set("#journey-xp",xp);
    set("#journey-need-xp",100-progress);set("#journey-next-level",level+1);set("#chip-level",level);set("#chip-xp",xp);
    const bar=$("#journey-xp-bar-fill");if(bar)bar.style.width=`${progress}%`;
    drawSkillTree();
    // Conquistas vêm do banco (luminova_profile_achievements): mesma regra para todos os perfis.
    const achRes=await sb.rpc("luminova_profile_achievements",{p_user:user.id});
    if(achRes.error)console.warn("conquistas:",achRes.error.message);
    const achList=achRes.data||[];
    const earnedCount=achList.filter(a=>a.earned).length;
    const doneCount=earnedCount;
    const html=achList.map(a=>{const pct=Math.round(Math.min(a.progress,a.target)*100/a.target);return `<article class="border p-3 ${a.earned?"border-[var(--lumi-accent-45)]":"border-white/10"}"><div class="flex items-center justify-between gap-2"><strong>${esc(a.icon)} ${esc(a.name)}</strong><span>${a.earned?"✦":"◇"}</span></div><p class="mt-1 text-sm text-muted-foreground">${esc(a.description)}</p><div class="mt-2 h-1 bg-white/10" aria-hidden="true"><div class="h-1 bg-[var(--lumi-accent)]" style="width:${pct}%"></div></div><small class="font-mono text-[10px] text-muted-foreground">${Math.min(a.progress,a.target)}/${a.target}</small></article>`;}).join("");
    const ac=$("#achievements-list");if(ac)ac.innerHTML=html;
    const tb=$("#tab-conquistas-body");
    if(tb)tb.innerHTML=html+skillState.nodes.filter(n=>skillState.unlocked.has(n.node_key)).map(n=>`<article class="border border-[var(--lumi-accent-45)] p-3"><div class="flex items-center justify-between gap-2"><strong>${esc(n.name)}</strong><span>✓</span></div><p class="mt-1 text-sm text-muted-foreground">Skill Tree · ${esc(n.description)}</p></article>`).join("");
    set("#achievements-count",doneCount);set("#achievements-total",achList.length+skillState.nodes.length);
    set("#tab-count-achievements",doneCount);set("#tab-count-communities",joined);
    set("#communities-subtitle",`${joined} comunidade(s) de que você participa`);
    const ab=$("#about-body");if(ab)ab.textContent=profile.bio||"Adicione uma apresentação ao editar seu perfil.";
    const stats=$("#stat-connections"); if(stats) stats.title=`${followers} seguidores · ${following} seguindo`;
    await Promise.all([renderCommunities(),renderFeed(),renderThanks(),renderActivity()]);
  }
  async function renderActivity(){
    const host=$("#tab-atividade-body");if(!host)return;
    const [posts,comments]=await Promise.all([
      sb.from("posts").select("id,content,created_at").eq("author_id",user.id).is("deleted_at",null).order("created_at",{ascending:false}).limit(10),
      sb.from("comments").select("id,content,created_at,post_id").eq("author_id",user.id).is("deleted_at",null).order("created_at",{ascending:false}).limit(10)
    ]);
    const items=[...(posts.data||[]).map(x=>({...x,k:"Publicou",icon:"✎"})),...(comments.data||[]).map(x=>({...x,k:"Comentou",icon:"↳"}))].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,15);
    host.innerHTML=items.length?items.map(x=>`<article class="border border-white/10 p-3"><div class="flex items-center justify-between gap-3 text-xs text-muted-foreground"><span>${x.icon} ${x.k}</span><time>${new Date(x.created_at).toLocaleString("pt-BR")}</time></div><p class="mt-2 text-sm whitespace-pre-wrap">${esc(x.content)}</p></article>`).join(""):'<p class="text-sm text-muted-foreground">Nenhuma atividade registrada ainda. Publique ou comente para começar sua jornada.</p>';
  }
  // ---- cor do texto: sugestões, contraste e prévia ----
  function bindTextColor(){
    const input=$("#textColorInput"),box=$("#textSwatches"),hint=$("#textContrastHint"),prev=$("#textPreview"),card=$("#cardBgInput");
    if(!input||!box)return;
    const update=()=>{
      const cbg=card?.value||TD().card,c=input.value,ratio=LUMI.contrast(c,cbg);
      prev.style.background=cbg;prev.style.color=c;
      const ok=ratio>=MIN_CONTRAST;
      hint.textContent=ok?`Contraste ${ratio.toFixed(1)}:1 — boa leitura ✓`:`Contraste ${ratio.toFixed(1)}:1 — insuficiente (mínimo ${MIN_CONTRAST}:1). Escolha outra cor.`;
      hint.style.color=ok?"#86efac":"#fca5a5";
      box.querySelectorAll("button").forEach(b=>{const bok=LUMI.contrast(b.dataset.c,cbg)>=MIN_CONTRAST;b.disabled=!bok;b.setAttribute("aria-pressed",String(b.dataset.c.toLowerCase()===c.toLowerCase()));b.title=bok?b.dataset.c:"Contraste insuficiente com a cor dos cartões";});
    };
    box.innerHTML=SWATCHES.map(c=>`<button type="button" class="lumi-swatch" data-c="${c}" style="background:${c}" aria-label="Usar a cor ${c}"></button>`).join("");
    box.addEventListener("click",e=>{const b=e.target.closest("button[data-c]");if(b&&!b.disabled){input.value=b.dataset.c;update();}});
    input.addEventListener("input",update);card?.addEventListener("input",update);
    $("#openSettings")?.addEventListener("click",update);$("#editProfile")?.addEventListener("click",update);
    update();
  }
  async function renderCommunities(){
    const host=$("#communities-list");if(!host)return;
    const {data:members,error:mErr}=await sb.from("community_members").select("community_id,role,status").eq("user_id",user.id).eq("status","active");
    if(mErr){host.innerHTML='<p class="col-span-full py-6 text-sm text-muted-foreground">Não foi possível carregar comunidades. Confira as políticas RLS do Supabase.</p>';return;}
    const {data:owned,error:oErr}=await sb.from("communities").select("id,name,description,cover_url,avatar_url,owner_id").eq("owner_id",user.id);
    if(oErr)console.warn(oErr);
    const ids=[...new Set([...(members||[]).map(x=>x.community_id),...(owned||[]).map(x=>x.id)])];
    if(!ids.length){host.innerHTML='<p class="col-span-full py-6 text-center text-sm text-muted-foreground">Você ainda não participa de comunidades. <a class="text-[var(--lumi-accent)] underline" href="./comunidades.html">Explore as comunidades ✦</a></p>';return;}
    const {data:rows,error}=await sb.from("communities").select("id,name,description,cover_url,avatar_url,owner_id").in("id",ids);
    if(error){host.innerHTML='<p class="col-span-full py-6 text-sm text-muted-foreground">Erro ao carregar comunidades. Verifique o acesso no Supabase.</p>';return;}
    host.innerHTML=(rows||[]).map(c=>`<a href="./comunidade-detalhe.html?id=${encodeURIComponent(c.id)}" class="block border border-[var(--lumi-accent-18)] bg-white/[0.02] hover:border-[var(--lumi-accent-45)]"><div class="h-[100px] border-b border-white/10" style="${c.cover_url?`background-image:linear-gradient(#090a1844,#090a18aa),url('${esc(c.cover_url)}');background-size:cover;background-position:center`:"background:linear-gradient(135deg,#16152e,#080b18)"}"></div><div class="p-4"><strong>${esc(c.name)}</strong><p class="mt-1 text-sm text-muted-foreground">${esc(c.description||"Uma comunidade LumiNova")}</p><span class="mt-3 inline-block font-mono text-[10px] uppercase tracking-widest text-[var(--lumi-accent)]">${c.owner_id===user.id?"CRIADORA":"MEMBRO"}</span></div></a>`).join("");
  }
  async function renderFeed(){
    const host=$("#feed-list");if(!host)return;
    const {data,error}=await sb.from("posts").select("id,author_id,content,created_at,post_type").eq("author_id",user.id).is("deleted_at",null).order("created_at",{ascending:false}).limit(12);
    if(error){host.innerHTML='<p class="py-5 text-sm text-muted-foreground">Não foi possível carregar publicações. Confira as políticas RLS.</p>';return;}
    if(!data?.length){host.innerHTML='<p class="py-5 text-sm text-muted-foreground">Suas publicações aparecerão aqui. Compartilhe sua primeira ideia acima.</p>';return;}
    host.innerHTML=data.map(p=>`<article class="border border-white/10 p-4"><div class="flex items-center justify-between gap-3"><strong>${esc(profile.display_name||"Você")}</strong><time class="text-xs text-muted-foreground">${new Date(p.created_at).toLocaleString("pt-BR")}</time></div><p class="mt-3 whitespace-pre-wrap text-sm leading-relaxed">${esc(p.content)}</p></article>`).join("");
  }
  async function renderThanks(){
    const host=$("#mural-list");if(!host)return;
    const {data,error}=await sb.from("gratitudes").select("id,message,created_at,giver:profiles!gratitudes_giver_id_fkey(username,display_name)").eq("recipient_id",user.id).order("created_at",{ascending:false}).limit(24);
    if(error){host.innerHTML='<p class="col-span-full py-5 text-sm text-muted-foreground">O mural não pôde ser carregado. Confira a migração 3 (tabela gratitudes).</p>';return;}
    if(!data?.length){host.innerHTML='<p class="col-span-full py-5 text-sm text-muted-foreground">Seu mural de agradecimentos aparecerá aqui quando alguém agradecer uma de suas publicações.</p>';return;}
    host.innerHTML=data.map(x=>`<article class="border border-[var(--lumi-accent-18)] p-4"><span class="text-[var(--lumi-accent)]">✦ ${esc(x.giver?.display_name||x.giver?.username||"Alguém")}</span><p class="mt-2 text-sm">${esc(x.message||"Agradeceu sua publicação.")}</p><time class="mt-2 block text-xs text-muted-foreground">${new Date(x.created_at).toLocaleDateString("pt-BR")}</time></article>`).join("");
  }
  function bindUI(){
    ["#openSettings","#openSettings2","#editProfile"].forEach(sel=>$(sel)?.addEventListener("click",()=>showModal(true)));
    $$("[data-close]").forEach(el=>el.addEventListener("click",()=>showModal(false)));
    $("#settingsModal")?.addEventListener("click",e=>{if(e.target.id==="settingsModal")showModal(false);});
    $("#profileForm")?.addEventListener("submit",async e=>{
      e.preventDefault();const btn=$('button[type="submit"]',e.currentTarget);if(btn)btn.disabled=true;
      try{
        const username=$("#handleInput")?.value.trim().replace(/^@/,"")||null;
        if(username&&!/^[a-zA-Z0-9_.-]{3,30}$/.test(username))throw Error("O usuário precisa ter de 3 a 30 caracteres.");
        const tc=$("#textColorInput")?.value||TD().text, cc=$("#cardBgInput")?.value||TD().card;
        if(window.LUMI && LUMI.contrast(tc,cc)<MIN_CONTRAST)throw Error("A cor do texto não tem contraste suficiente com a cor dos cartões. Escolha outra.");
        await saveProfile({display_name:$("#nameInput")?.value.trim()||"Novo usuário",username,bio:$("#bioInput")?.value.trim()||""},{
          background:custom("#pageBgInput","page"),accent:custom("#accentInput","accent"),card:custom("#cardBgInput","card"),textColor:custom("#textColorInput","text"),coverStyle:$("#coverStyle")?.value||"cosmic",
          coverMessage:$("#coverMessageInput")?.value??"Minha jornada, minha evolução ✦",coverMessagePosition:$("#coverMessagePosition")?.value||"top-left",
          hiddenWidgets:$$('[data-widget-toggle]').filter(x=>!x.checked).map(x=>x.dataset.widgetToggle)
        });
        showModal(false);toast("Perfil salvo no Supabase.");await renderSkillTree();
      }catch(err){toast("Não foi possível salvar: "+err.message);}finally{if(btn)btn.disabled=false;}
    });
    $$("[data-widget-toggle]").forEach(el=>el.addEventListener("change",async()=>{
      try{await saveProfile({}, {hiddenWidgets:$$("[data-widget-toggle]").filter(x=>!x.checked).map(x=>x.dataset.widgetToggle)});}
      catch(e){toast("Erro ao salvar cartão: "+e.message);}
    }));
    ["#pageBgInput","#accentInput","#cardBgInput"].forEach(sel=>$(sel)?.addEventListener("input",()=>{
      const st={background:$("#pageBgInput")?.value,accent:$("#accentInput")?.value,card:$("#cardBgInput")?.value};
      if(st.background)document.body.style.background=st.background;
      if(st.accent){document.documentElement.style.setProperty("--lumi-accent",st.accent);document.documentElement.style.setProperty("--primary",st.accent);}
      if(st.card)document.documentElement.style.setProperty("--lumi-card",st.card);
    }));
    $("#coverStyle")?.addEventListener("change",e=>{const st={...settings(),coverStyle:e.target.value};profile={...profile,profile_settings:st};applyTheme();});
    $("#coverMessageInput")?.addEventListener("input",e=>applyCoverMessage(e.target.value,$("#coverMessagePosition")?.value||"top-left"));
    $("#coverMessagePosition")?.addEventListener("change",e=>applyCoverMessage($("#coverMessageInput")?.value||"",e.target.value));
    $("#avatarEdit")?.addEventListener("click",()=>$("#avatarFile")?.click());
    $("#coverEdit")?.addEventListener("click",()=>$("#coverFile")?.click());
    $("#avatarFile")?.addEventListener("change",async e=>{try{const url=await uploadImage(e.target.files?.[0],"avatar");if(url){await saveProfile({avatar_url:url});toast("Foto de perfil salva no Supabase.");}}catch(err){toast(err.message);}finally{e.target.value="";}});
    $("#coverFile")?.addEventListener("change",async e=>{try{const url=await uploadImage(e.target.files?.[0],"cover");if(url){await saveProfile({cover_url:url});toast("Capa salva no Supabase.");}}catch(err){toast(err.message);}finally{e.target.value="";}});
    $("#postForm")?.addEventListener("submit",async e=>{
      e.preventDefault();const input=$("#postInput"),content=input?.value.trim();if(!content)return;
      const btn=$('button[type="submit"]',e.currentTarget);if(btn)btn.disabled=true;
      try{const {error}=await sb.from("posts").insert({author_id:user.id,content,post_type:"text",visibility:"public"});if(error)throw error;input.value="";const counter=$("#composer-count");if(counter)counter.textContent="0/500";toast("Publicação enviada ao Supabase.");await renderSkillTree();}
      catch(err){toast("Não foi possível publicar: "+err.message);}finally{if(btn)btn.disabled=false;}
    });
    $("#postInput")?.addEventListener("input",e=>{const c=$("#composer-count");if(c)c.textContent=`${e.target.value.length}/500`;});
    $("#shareProfile")?.addEventListener("click",async()=>{try{if(navigator.share)await navigator.share({title:"LumiNova",text:"Confira meu perfil!",url:location.href});else{await navigator.clipboard.writeText(location.href);toast("Link copiado.");}}catch(_){}});
    $("#addCommunity")?.addEventListener("click",()=>location.href="./comunidades.html");
    $("#addThanks")?.addEventListener("click",()=>{const mural=$("#thanksSection");mural?.scrollIntoView({behavior:"smooth",block:"start"});toast("Aqui ficam os agradecimentos recebidos no Supabase.");});
    const tabTargets={geral:"tab-geral",atividade:"tab-atividade",comunidades:"tab-comunidades",conquistas:"tab-conquistas",sobre:"tab-sobre"};
    $$("[data-tab]").forEach(button=>button.addEventListener("click",()=>{
      const selected=button.dataset.tab;
      Object.values(tabTargets).forEach(id=>$("#"+id)?.classList.add("hidden"));
      $("#"+(tabTargets[selected]||"tab-geral"))?.classList.remove("hidden");
      $$("[data-tab]").forEach(b=>{b.setAttribute("aria-selected",String(b===button));b.classList.toggle("text-[var(--lumi-accent)]",b===button);b.classList.toggle("text-muted-foreground",b!==button);});
    }));
    $("#profileSearch")?.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();const q=e.target.value.trim();location.href="./explorar.html"+(q?"?q="+encodeURIComponent(q):"");}});
    bindTextColor();
    const qs=new URLSearchParams(location.search);
    const wantTab=qs.get("tab");
    if(wantTab&&tabTargets[wantTab])$(`[data-tab="${wantTab}"]`)?.click();
    if(qs.get("edit")==="1")showModal(true);
    $("#closeConstruction")?.addEventListener("click",()=>$("#constructionModal")?.classList.remove("open"));
    $("#constructionOk")?.addEventListener("click",()=>$("#constructionModal")?.classList.remove("open"));
  }
  async function init(){
    if(!window.supabase||!cfg?.url||!cfg?.anonKey){location.replace("./index.html");return;}
    sb=window.luminovaSupabase||window.luminovaCreateClient();window.luminovaSupabase=sb;
    const {data:{session},error}=await sb.auth.getSession();
    if(error||!session?.user){location.replace("./index.html?redirect=perfil.html");return;}
    user=session.user;
    sb.auth.onAuthStateChange((event,next)=>{if(event==="SIGNED_OUT"||!next?.user)location.replace("./index.html");});
    try{await ensureProfile();renderProfile();bindUI();await renderSkillTree();}
    catch(err){console.error("LumiNova perfil:",err);toast("Erro ao carregar perfil: "+(err.message||"verifique Supabase/RLS")); }
  }
  document.addEventListener("DOMContentLoaded",init);
})();
