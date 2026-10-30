/* Perfil LUMINOVA: persistência exclusivamente no Supabase (exceto sessão gerenciada pelo SDK). */
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s),
    $$ = (s) => [...document.querySelectorAll(s)];
  const esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  let sb, user, profile;
  const DEFAULT_BG = "#0b0917",
    DEFAULT_ACCENT = "#e8c88a";
  function toastMsg(msg) {
    const el = $("#toast");
    if (el) {
      el.textContent = msg;
      el.classList.add("show");
      setTimeout(() => el.classList.remove("show"), 2800);
    } else alert(msg);
  }
  async function upload(file, bucket, folder, max = 5 * 1024 * 1024) {
    if (!file) return null;
    if (!file.type.startsWith("image/")) throw Error("Escolha uma imagem.");
    if (file.size > max) throw Error("A imagem excede o limite permitido.");
    const safe = file.name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]/g, "-");
    const path = `${user.id}/${folder}/${Date.now()}-${safe}`;
    const { error } = await sb.storage
      .from(bucket)
      .upload(path, file, { upsert: false, contentType: file.type });
    if (error) throw error;
    return sb.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  }
  function settings() {
    return profile?.profile_settings || {};
  }
  function apply() {
    if (!profile) return;
    const st = settings();
    const name = profile.display_name || "Seu perfil",
      handle = profile.username || "";
    if ($("#displayName")) $("#displayName").textContent = name;
    if ($("#sideName")) $("#sideName").textContent = name;
    if ($("#displayHandle"))
      $("#displayHandle").textContent = handle ? "@" + handle : "@seu_usuario";
    if ($("#displayBio"))
      $("#displayBio").textContent =
        profile.bio || "Adicione uma bio para apresentar seu universo.";
    if ($("#nameInput")) $("#nameInput").value = profile.display_name || "";
    if ($("#handleInput")) $("#handleInput").value = profile.username || "";
    if ($("#bioInput")) $("#bioInput").value = profile.bio || "";
    if ($("#pageBgInput"))
      $("#pageBgInput").value = st.background || DEFAULT_BG;
    if ($("#accentInput"))
      $("#accentInput").value = st.accent || DEFAULT_ACCENT;
    if ($("#coverStyle")) $("#coverStyle").value = st.coverStyle || "cosmic";
    if ($("#favoriteQuote"))
      $("#favoriteQuote").textContent =
        st.favoriteQuote ||
        "Aprender é descobrir que sempre existe um novo universo.";
    if (profile.avatar_url) {
      if ($("#avatar")) $("#avatar").src = profile.avatar_url;
      if ($("#sideAvatar")) $("#sideAvatar").src = profile.avatar_url;
      if ($("#composerAvatar")) $("#composerAvatar").src = profile.avatar_url;
    }
    if (profile.cover_url && $("#cover"))
      $("#cover").style.backgroundImage =
        `linear-gradient(90deg,#090a18aa,#090a1844),url("${profile.cover_url}")`;
    document.documentElement.style.setProperty(
      "--bg",
      st.background || DEFAULT_BG,
    );
    document.documentElement.style.setProperty(
      "--accent",
      st.accent || DEFAULT_ACCENT,
    );
    document.documentElement.style.setProperty(
      "--gold",
      st.accent || DEFAULT_ACCENT,
    );
    if (st.theme === "light") document.body.classList.add("light-mode");
    else document.body.classList.remove("light-mode");
    $$("[data-widget]").forEach((el) => {
      const key = el.dataset.widget;
      el.hidden =
        Array.isArray(st.hiddenWidgets) && st.hiddenWidgets.includes(key);
    });
    $$("[data-widget-toggle]").forEach(
      (el) =>
        (el.checked = !(st.hiddenWidgets || []).includes(
          el.dataset.widgetToggle,
        )),
    );
  }
  async function saveProfile(patch, settingsPatch) {
    const updates = { ...patch };
    if (settingsPatch)
      updates.profile_settings = { ...settings(), ...settingsPatch };
    const { data, error } = await sb
      .from("profiles")
      .update(updates)
      .eq("id", user.id)
      .select("*")
      .single();
    if (error) throw error;
    profile = data;
    apply();
  }
  function bindModals() {
    const modal = $("#settingsModal");
    $("#openSettings")?.addEventListener("click", () =>
      modal?.classList.add("open"),
    );
    $("#openSettings2")?.addEventListener("click", () =>
      modal?.classList.add("open"),
    );
    $("#editProfile")?.addEventListener("click", () =>
      modal?.classList.add("open"),
    );
    $$("[data-close]").forEach((b) =>
      b.addEventListener("click", () => modal?.classList.remove("open")),
    );
    $("#coverEdit")?.addEventListener("click", () => $("#coverFile")?.click());
    $("#avatarEdit")?.addEventListener("click", () =>
      $("#avatarFile")?.click(),
    );
    $("#avatarFile")?.addEventListener("change", async (e) => {
      try {
        const url = await upload(
          e.target.files?.[0],
          "profile-media",
          "avatar",
        );
        if (url) {
          await saveProfile({ avatar_url: url });
          toastMsg("Foto de perfil salva no Supabase.");
        }
      } catch (err) {
        toastMsg(err.message);
      } finally {
        e.target.value = "";
      }
    });
    $("#coverFile")?.addEventListener("change", async (e) => {
      try {
        const url = await upload(e.target.files?.[0], "profile-media", "cover");
        if (url) {
          await saveProfile({ cover_url: url });
          toastMsg("Capa salva no Supabase.");
        }
      } catch (err) {
        toastMsg(err.message);
      } finally {
        e.target.value = "";
      }
    });
    $("#profileForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = e.currentTarget.querySelector("[type=submit]");
      if (btn) btn.disabled = true;
      try {
        const username =
          $("#handleInput")?.value.trim().replace(/^@/, "") || null;
        if (username && !/^[a-zA-Z0-9_.-]{3,30}$/.test(username))
          throw Error(
            "O usuário deve ter de 3 a 30 caracteres: letras, números, ponto, hífen ou sublinhado.",
          );
        await saveProfile(
          {
            display_name: $("#nameInput")?.value.trim() || "Novo usuário",
            username,
            bio: $("#bioInput")?.value.trim() || "",
          },
          {
            background: $("#pageBgInput")?.value || DEFAULT_BG,
            accent: $("#accentInput")?.value || DEFAULT_ACCENT,
            coverStyle: $("#coverStyle")?.value || "cosmic",
            hiddenWidgets: $$("[data-widget-toggle]")
              .filter((x) => !x.checked)
              .map((x) => x.dataset.widgetToggle),
          },
        );
        modal?.classList.remove("open");
        toastMsg("Perfil atualizado e salvo na nuvem.");
      } catch (err) {
        toastMsg("Não foi possível salvar: " + err.message);
      } finally {
        if (btn) btn.disabled = false;
      }
    });
    $("#pageBgInput")?.addEventListener("input", (e) => {
      document.documentElement.style.setProperty("--bg", e.target.value);
      document.body.style.background = e.target.value;
    });
    $("#accentInput")?.addEventListener("input", (e) => {
      document.documentElement.style.setProperty("--accent", e.target.value);
      document.documentElement.style.setProperty("--gold", e.target.value);
    });
    $$("[data-widget-toggle]").forEach((el) =>
      el.addEventListener("change", async () => {
        try {
          await saveProfile(
            {},
            {
              hiddenWidgets: $$("[data-widget-toggle]")
                .filter((x) => !x.checked)
                .map((x) => x.dataset.widgetToggle),
            },
          );
        } catch (err) {
          toastMsg(err.message);
        }
      }),
    );
    $("#editQuote")?.addEventListener("click", async () => {
      const value = prompt(
        "Sua frase favorita:",
        settings().favoriteQuote || "",
      );
      if (value === null) return;
      try {
        await saveProfile({}, { favoriteQuote: value.slice(0, 240) });
        toastMsg("Frase salva.");
      } catch (e) {
        toastMsg(e.message);
      }
    });
  }
  async function metrics() {
    const [posts, created, joined, followers, following, comments] =
      await Promise.all([
        sb
          .from("posts")
          .select("id", { count: "exact", head: true })
          .eq("author_id", user.id)
          .is("deleted_at", null),
        sb
          .from("communities")
          .select("id", { count: "exact", head: true })
          .eq("owner_id", user.id),
        sb
          .from("community_members")
          .select("community_id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("status", "active"),
        sb
          .from("follows")
          .select("follower_id", { count: "exact", head: true })
          .eq("followed_id", user.id),
        sb
          .from("follows")
          .select("followed_id", { count: "exact", head: true })
          .eq("follower_id", user.id),
        sb
          .from("comments")
          .select("id", { count: "exact", head: true })
          .eq("author_id", user.id)
          .is("deleted_at", null),
      ]);
    const count = (x) => x?.count || 0;
    const totalContrib = count(posts) + count(comments);
    const stats = $("#profileStats");
    if (stats)
      stats.innerHTML = [
        [count(followers), "Seguidores"],
        [count(following), "Seguindo"],
        [count(posts), "Publicações"],
        [count(joined), "Comunidades"],
        [totalContrib, "Contribuições"],
      ]
        .map(([n, l]) => `<span><strong>${n}</strong>${l}</span>`)
        .join("");
    const level = Math.floor(totalContrib / 5) + 1;
    if ($("#profileLevel"))
      $("#profileLevel").textContent =
        `NÍVEL ${String(level).padStart(2, "0")}`;
    const countNode = $("#profileCommunityCount");
    if (countNode) countNode.textContent = String(count(joined));
    const contrib = $("#contributionsValue");
    if (contrib) contrib.textContent = String(totalContrib);
    const achCount = $("#profileAchievementCount");
    if (achCount)
      achCount.textContent = String(
        (count(posts) > 0 ? 1 : 0) +
          (count(joined) > 0 ? 1 : 0) +
          (profile.bio ? 1 : 0),
      );
    const progress = $(".progress-card");
    if (progress) {
      progress.innerHTML = `<div class="side-card-heading"><h3>Minha jornada</h3><span class="sparkle">✧</span></div><div class="ln-journey"><div class="ln-journey-top"><strong>Nível ${level}</strong><span>${totalContrib} contribuições</span></div><div class="ln-journey-track"><span style="width:${Math.min(100, (totalContrib % 5) * 20)}%"></span></div><small>${5 - (totalContrib % 5)} contribuição(ões) para o próximo nível</small></div>`;
    }
    const skill = $("#skillTreeSection");
    if (skill) {
      const nodes = [
        ["Primeira publicação", count(posts), 1],
        ["Conversas", count(comments), 3],
        ["Primeira comunidade", count(joined), 1],
        ["Perfil completo", profile.bio ? 1 : 0, 1],
      ];
      skill.innerHTML = `<div class="section-heading"><div><span class="eyebrow">MEU DESENVOLVIMENTO</span><h2>Skill Tree <span class="sparkle">✦</span></h2><p class="section-subtitle">Progresso calculado com suas atividades reais no Supabase.</p></div></div><div class="ln-skill-grid">${nodes.map(([name, n, need]) => `<article class="ln-skill-node ${n >= need ? "unlocked" : ""}"><span>${n >= need ? "✦" : "◇"}</span><div><strong>${name}</strong><small>${Math.min(n, need)} de ${need}</small><div class="ln-journey-track"><span style="width:${Math.min(100, (n / need) * 100)}%"></span></div></div></article>`).join("")}</div>`;
    }
    await renderMyCommunities();
    await renderContributions();
  }
  async function renderMyCommunities() {
    const grid = $("#communityGrid");
    if (!grid || !user) return;
    const { data: members, error: mErr } = await sb
      .from("community_members")
      .select("community_id,role,status")
      .eq("user_id", user.id)
      .eq("status", "active");
    if (mErr) {
      grid.innerHTML =
        '<div class="empty-feed-message">Não foi possível carregar suas comunidades. Confira as políticas RLS no Supabase.</div>';
      return;
    }
    const { data: owned, error: oErr } = await sb
      .from("communities")
      .select("id,name,description,cover_url,avatar_url,owner_id")
      .eq("owner_id", user.id);
    if (oErr) console.warn(oErr);
    const ids = [
      ...new Set([
        ...(members || []).map((x) => x.community_id),
        ...(owned || []).map((x) => x.id),
      ]),
    ];
    if (!ids.length) {
      grid.innerHTML =
        '<div class="empty-feed-message">Você ainda não participa de comunidades. Explore as comunidades para entrar em uma.</div>';
      return;
    }
    const { data: rows, error } = await sb
      .from("communities")
      .select("id,name,description,cover_url,avatar_url,owner_id")
      .in("id", ids);
    if (error) {
      grid.innerHTML =
        '<div class="empty-feed-message">Não foi possível carregar as comunidades.</div>';
      return;
    }
    grid.innerHTML = (rows || [])
      .map(
        (c) =>
          `<article class="community-card" data-community-id="${esc(c.id)}"><div class="community-art" ${c.cover_url ? `style="background-image:linear-gradient(#090a1844,#090a18aa),url('${esc(c.cover_url)}');background-size:cover;background-position:center"` : ""}><span>✦</span><b>${c.owner_id === user.id ? "CRIADORA" : "MEMBRO"}</b></div><div class="community-body"><div class="card-title"><h3>${esc(c.name)}</h3></div><p>${esc(c.description || "Uma comunidade LumiNova")}</p><div class="card-footer"><span class="tag">COMUNIDADE</span><span class="joined">${c.owner_id === user.id ? "Criada por você" : "Participando"}</span></div></div></article>`,
      )
      .join("");
    grid
      .querySelectorAll("[data-community-id]")
      .forEach((el) =>
        el.addEventListener(
          "click",
          () =>
            (location.href =
              "comunidade-detalhe.html?id=" +
              encodeURIComponent(el.dataset.communityId)),
        ),
      );
  }
  async function renderContributions() {
    const host = $("#contributionsFeed");
    if (!host || !user) return;
    const [posts, comments] = await Promise.all([
      sb
        .from("posts")
        .select("id,content,created_at,post_type")
        .eq("author_id", user.id)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(8),
      sb
        .from("comments")
        .select("id,content,created_at,post_id")
        .eq("author_id", user.id)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(8),
    ]);
    if (posts.error || comments.error) {
      host.innerHTML =
        '<div class="empty-feed-message">Não foi possível carregar as contribuições. Confira as políticas RLS do Supabase.</div>';
      return;
    }
    const items = [
      ...(posts.data || []).map((x) => ({ ...x, kind: "Publicação" })),
      ...(comments.data || []).map((x) => ({ ...x, kind: "Comentário" })),
    ]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 10);
    host.innerHTML = items.length
      ? items
          .map(
            (x) =>
              `<article class="contribution-item"><span class="contribution-icon">${x.kind === "Publicação" ? "✎" : "↳"}</span><div><div class="contribution-item-top"><strong>${x.kind}</strong><time>${new Date(x.created_at).toLocaleDateString("pt-BR")}</time></div><p>${esc(x.content || "")}</p></div></article>`,
          )
          .join("")
      : '<div class="empty-feed-message">Você ainda não fez publicações ou comentários. Quando participar, suas contribuições aparecerão aqui.</div>';
  }
  function initProfileSearch() {
    const input = $("#profileSearch");
    if (!input) return;
    let timer;
    let panel = document.createElement("div");
    panel.id = "profileSearchResults";
    panel.className = "ln-profile-search-results";
    input.closest(".search-box")?.append(panel);
    const run = async () => {
      const q = input.value.trim();
      if (q.length < 2) {
        panel.classList.remove("visible");
        panel.innerHTML = "";
        return;
      }
      panel.innerHTML = "<p>Buscando na LumiNova…</p>";
      panel.classList.add("visible");
      try {
        const [people, communities, posts] = await Promise.all([
          sb
            .from("profiles")
            .select("id,display_name,username,bio")
            .or(
              `display_name.ilike.%${q.replace(/[,%()]/g, " ")}%,username.ilike.%${q.replace(/[,%()]/g, " ")}%`,
            )
            .limit(5),
          sb
            .from("communities")
            .select("id,name,description")
            .or(
              `name.ilike.%${q.replace(/[,%()]/g, " ")}%,description.ilike.%${q.replace(/[,%()]/g, " ")}%`,
            )
            .eq("visibility", "public")
            .limit(5),
          sb
            .from("posts")
            .select("id,content,author_id")
            .ilike("content", `%${q.replace(/[%]/g, "")}%`)
            .is("deleted_at", null)
            .eq("visibility", "public")
            .limit(5),
        ]);
        const results = [
          ...(people.data || []).map((x) => ({
            type: "Pessoa",
            label: x.display_name || x.username || "Perfil",
            sub: x.bio || "Perfil LumiNova",
            url: `perfil-publico.html?id=${encodeURIComponent(x.id)}`,
          })),
          ...(communities.data || []).map((x) => ({
            type: "Comunidade",
            label: x.name,
            sub: x.description || "Comunidade LumiNova",
            url: `comunidade-detalhe.html?id=${encodeURIComponent(x.id)}`,
          })),
          ...(posts.data || []).map((x) => ({
            type: "Publicação",
            label: x.content.slice(0, 90),
            sub: "Abrir comunidade/feed",
            url: "geral.html",
          })),
        ];
        panel.innerHTML = results.length
          ? results
              .map(
                (x) =>
                  `<a href="${x.url}"><small>${x.type}</small><strong>${esc(x.label)}</strong><span>${esc(x.sub)}</span></a>`,
              )
              .join("")
          : "<p>Nenhum resultado encontrado.</p>";
      } catch (e) {
        console.error(e);
        panel.innerHTML =
          "<p>A busca falhou. Confira as permissões de leitura (RLS) do Supabase.</p>";
      }
    };
    input.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(run, 250);
    });
    document.addEventListener("click", (e) => {
      if (!panel.contains(e.target) && e.target !== input)
        panel.classList.remove("visible");
    });
  }
  function initProfileControls() {
    document.querySelectorAll("[data-tab]").forEach((b) =>
      b.addEventListener("click", () => {
        const tab = b.dataset.tab;
        document
          .querySelectorAll("[data-tab]")
          .forEach((x) => x.classList.toggle("active", x === b));
        const map = {
          geral: "#generalFeed",
          comunidades: "#communityGrid",
          conquistas: "#achievementsPanel",
          sobre: "#aboutPanel",
          atividade: "#allActivity",
        };
        document
          .querySelectorAll(
            "#generalFeed,#communityGrid,#achievementsPanel,#aboutPanel,#allActivity",
          )
          .forEach((el) => el.classList.add("hidden"));
        const target = document.querySelector(map[tab]);
        if (target) target.classList.remove("hidden");
        const title = $("#sectionTitle");
        if (title)
          title.textContent =
            {
              geral: "Geral",
              comunidades: "Minhas comunidades",
              conquistas: "Minhas conquistas",
              sobre: "Sobre mim",
              atividade: "Minha atividade",
            }[tab] || "Meu perfil";
      }),
    );
    $("#themeToggle")?.addEventListener("click", async () => {
      const next = settings().theme === "light" ? "dark" : "light";
      try {
        await saveProfile({}, { theme: next });
        toastMsg(
          next === "light" ? "Tema claro ativado." : "Tema escuro ativado.",
        );
      } catch (e) {
        toastMsg("Não foi possível salvar o tema: " + e.message);
      }
    });
    $("#shareProfile")?.addEventListener("click", async () => {
      const url = location.href;
      try {
        if (navigator.share)
          await navigator.share({ title: "Meu perfil LumiNova", url });
        else if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(url);
          toastMsg("Link do perfil copiado.");
        } else prompt("Copie o link do perfil:", url);
      } catch (e) {
        if (e.name !== "AbortError")
          toastMsg("Não foi possível compartilhar o perfil.");
      }
    });
  }

  async function init() {
    const config = window.LUMINOVA_SUPABASE_CONFIG;
    if (!config || !window.supabase?.createClient)
      throw Error("Configuração Supabase ausente.");
    sb =
      window.luminovaSupabase ||
      window.supabase.createClient(config.url, config.anonKey, {
        auth: {
          storage: window.sessionStorage,
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      });
    window.luminovaSupabase = sb;
    const { data, error } = await sb.auth.getUser();
    if (error || !data.user) {
      location.href = "index.html";
      return;
    }
    user = data.user;
    let res = await sb
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();
    if (res.error) throw res.error;
    if (!res.data) {
      const { data: d, error: e } = await sb
        .from("profiles")
        .insert({
          id: user.id,
          display_name:
            user.user_metadata?.name ||
            user.email?.split("@")[0] ||
            "Novo usuário",
          username: user.user_metadata?.username || null,
        })
        .select("*")
        .single();
      if (e) throw e;
      profile = d;
    } else profile = res.data;
    bindModals();
    initProfileSearch();
    initProfileControls();
    apply();
    await metrics();
  }
  document.addEventListener("DOMContentLoaded", () => {
    if ($("#profileForm") || $("#displayName"))
      init().catch((e) => {
        console.error(e);
        toastMsg("Erro ao carregar seu perfil do Supabase: " + e.message);
      });
  });
})();
