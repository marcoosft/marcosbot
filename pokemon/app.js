// Dex GO Assistente — toda a lógica roda localmente sobre POKEDEX (data.js).
// Nenhuma chamada de IA/rede é feita para gerar recomendações.

const TYPE_PT = {
  normal:'Normal', fire:'Fogo', water:'Água', electric:'Elétrico', grass:'Grama',
  ice:'Gelo', fighting:'Lutador', poison:'Veneno', ground:'Terra', flying:'Voador',
  psychic:'Psíquico', bug:'Inseto', rock:'Pedra', ghost:'Fantasma', dragon:'Dragão',
  dark:'Sombrio', steel:'Aço', fairy:'Fada',
};
const TYPE_COLOR = {
  normal:'#A8A878', fire:'#F08030', water:'#6890F0', electric:'#F0C020', grass:'#78C850',
  ice:'#98D8D8', fighting:'#C03028', poison:'#A040A0', ground:'#E0C068', flying:'#A890F0',
  psychic:'#F85888', bug:'#A8B820', rock:'#B8A038', ghost:'#705898', dragon:'#7038F8',
  dark:'#705848', steel:'#B8B8D0', fairy:'#EE99AC',
};
const LEAGUE_LABEL = { great:'Great', ultra:'Ultra', master:'Master' };
const LEAGUE_CAP = { great:'CP 1500', ultra:'CP 2500', master:'sem limite de CP' };
const TIER_WEIGHT = { S:96, A:80, B:55, C:22 };

function stripAccents(s){
  return s.normalize('NFD').replace(/[̀-ͯ]/g,'');
}
function normalize(s){
  return stripAccents(String(s).toLowerCase()).replace(/[^a-z0-9]/g,'');
}

const BY_ID = {};
POKEDEX.forEach(p => { BY_ID[p.id] = p; });

// ---------------- Recomendação ----------------

function pvpMax(entry){
  const vals = Object.values(entry.pvp || {});
  return vals.length ? Math.max(...vals) : null;
}
function raidBest(entry){
  const tiers = (entry.raid && entry.raid.tiers) || {};
  let best = null;
  for (const [type, info] of Object.entries(tiers)){
    if (!best || TIER_WEIGHT[info.tier] > TIER_WEIGHT[best.tier]){
      best = { type, ...info };
    }
  }
  return best;
}
function metaScore(entry){
  const pvp = pvpMax(entry) || 0;
  const raid = raidBest(entry);
  const raidScore = raid ? TIER_WEIGHT[raid.tier] : 0;
  return Math.max(pvp, raidScore);
}

// Percorre a árvore de evolução (sem ciclos) coletando todas as formas finais alcançáveis,
// junto com o caminho (custo de doce acumulado + requisitos especiais) até cada uma.
function evolutionBranches(entry, path = [], depth = 0){
  if (!entry.evoTo.length || depth > 6){
    return [{ entry, path }];
  }
  let out = [];
  for (const edge of entry.evoTo){
    const next = BY_ID[edge.id];
    if (!next) continue;
    out = out.concat(evolutionBranches(next, [...path, { from: entry.id, ...edge }], depth + 1));
  }
  return out.length ? out : [{ entry, path }];
}

function bestBranch(entry){
  const branches = evolutionBranches(entry);
  return branches.reduce((best, b) => {
    const score = metaScore(b.entry);
    return (!best || score > best.score) ? { ...b, score } : best;
  }, null);
}

function fmtCandyPath(path){
  if (!path.length) return null;
  let total = 0, unknown = false;
  const reqs = [];
  for (const step of path){
    if (typeof step.candy === 'number') total += step.candy;
    else unknown = true;
    if (step.req) reqs.push(step.req);
  }
  return { total, unknown, reqs };
}

function evolveAdvice(entry){
  if (!entry.evoTo.length){
    return { verdict: 'neutral', title: 'Já é a evolução final', text: `${entry.name} não evolui mais — não há decisão de evolução a tomar aqui.` };
  }
  const branch = bestBranch(entry);
  const cost = fmtCandyPath(branch.path);
  const finalName = branch.entry.name;
  const isDirect = branch.entry.id === entry.evoTo[0] && branch.path.length === 1;
  const raid = raidBest(branch.entry);
  const pvp = pvpMax(branch.entry);

  const reasonParts = [];
  if (pvp !== null && pvp >= 60) reasonParts.push(`boa pontuação em PvP (${pvp.toFixed(0)}/100)`);
  if (raid && (raid.tier === 'S' || raid.tier === 'A')) reasonParts.push(`atacante tier ${raid.tier} em raids de ${TYPE_PT[raid.type] || raid.type}`);
  const reason = reasonParts.length ? reasonParts.join(' e ') : 'stats medianos, sem destaque competitivo';

  const worth = branch.score >= 55;
  const candyTxt = cost
    ? (cost.unknown ? 'quantidade de doce da rota não disponível' : `${cost.total} doces`)
    : '';
  const reqTxt = cost && cost.reqs.length ? ` (além de: ${cost.reqs.join(', ')})` : '';

  if (worth){
    return {
      verdict: 'good',
      title: `Vale evoluir até ${finalName}`,
      text: `${finalName} tem ${reason}. Custo até lá: ${candyTxt}${reqTxt}.` +
        (branch.entry.id !== entry.evoTo[0].id ? ' (passa por evoluções intermediárias)' : ''),
    };
  }
  return {
    verdict: 'bad',
    title: `Não é prioridade evoluir`,
    text: `Mesmo evoluído até ${finalName}, o resultado tem ${reason}. Evolua só se for para completar a Pokédex, pegar XP ou como candidato de coleção.`,
  };
}

function pvpAdvice(entry){
  const leagues = ['great','ultra','master'].filter(l => entry.pvp && entry.pvp[l] != null);
  if (!leagues.length){
    return { verdict: 'bad', hasData: false, leagues: [] };
  }
  const best = leagues.reduce((b,l) => entry.pvp[l] > entry.pvp[b] ? l : b, leagues[0]);
  const bestScore = entry.pvp[best];
  let verdict = 'bad', label = 'Fraco em PvP';
  if (bestScore >= 90){ verdict = 'good'; label = `Excelente em ${LEAGUE_LABEL[best]} League`; }
  else if (bestScore >= 78){ verdict = 'good'; label = `Muito bom em ${LEAGUE_LABEL[best]} League`; }
  else if (bestScore >= 60){ verdict = 'mid'; label = `Opção viável em ${LEAGUE_LABEL[best]} League`; }
  else { verdict = 'bad'; label = 'Abaixo do meta competitivo em PvP'; }
  return { verdict, hasData: true, label, leagues, best };
}

function raidAdvice(entry){
  const best = raidBest(entry);
  if (!best) return { verdict: 'bad', hasData: false };
  const labels = {
    S: 'Um dos melhores atacantes desse tipo — prioridade em raids',
    A: 'Ótimo atacante para raids desse tipo',
    B: 'Atacante razoável, dá pro time em raids do dia a dia',
    C: 'Não se destaca como atacante de raid',
  };
  const verdict = best.tier === 'S' || best.tier === 'A' ? 'good' : (best.tier === 'B' ? 'mid' : 'bad');
  return { verdict, hasData: true, best, label: labels[best.tier] };
}

function candyAdvice(entry){
  const evo = evolveAdvice(entry);
  const own = metaScore(entry);
  if (entry.evoTo.length){
    if (evo.verdict === 'good'){
      return { verdict: 'good', text: `Sim — os doces valem a pena para evoluir. ${evo.text}` };
    }
    return { verdict: 'bad', text: `Não compensa gastar doce além do necessário para Pokédex. ${evo.text}` };
  }
  // já é forma final: doce vai virar Doce XL (nível 41-50)
  if (own >= 78){
    return { verdict: 'good', text: `Vale investir Doce XL nele — ${entry.name} é competitivo e aguenta subir de nível (41-50) para PvP/raids de ponta.` };
  }
  if (own >= 55){
    return { verdict: 'mid', text: `Investir Doce XL é opcional — ${entry.name} é utilizável, mas não é prioridade máxima. Priorize Pokémon com pontuação melhor.` };
  }
  return { verdict: 'bad', text: `Não vale investir Doce XL nele — desempenho competitivo baixo. Guarde o doce para outro Pokémon da mesma família.` };
}

// ---------------- Render helpers ----------------

function typeChip(type){
  const c = TYPE_COLOR[type] || '#888';
  return `<span class="type-chip" style="background:${c}">${TYPE_PT[type] || type}</span>`;
}
function dexBadgeStyle(entry){
  const c = TYPE_COLOR[entry.types[0]] || '#555';
  const c2 = TYPE_COLOR[entry.types[1]] || c;
  return `background:linear-gradient(135deg,${c},${c2})`;
}

function renderResults(list){
  const el = document.getElementById('results');
  if (!list.length){
    el.innerHTML = `<div class="empty-state"><div class="big">🔎</div><p>Nenhum Pokémon encontrado.<br>Tente outro nome.</p></div>`;
    return;
  }
  el.innerHTML = list.slice(0, 60).map(p => {
    const raid = raidBest(p);
    const pvp = pvpMax(p);
    let badge = '';
    if (raid && (raid.tier === 'S' || raid.tier === 'A')){
      badge = `<span class="mini-badge tier-${raid.tier}">Raid ${raid.tier}</span>`;
    } else if (pvp && pvp >= 85){
      badge = `<span class="mini-badge tier-A">PvP ${pvp.toFixed(0)}</span>`;
    }
    return `
    <div class="result-card" data-id="${p.id}">
      <div class="dex-badge" style="${dexBadgeStyle(p)}">#${p.dex}</div>
      <div class="rc-info">
        <div class="rc-name">${p.name}</div>
        <div class="rc-types">${p.types.map(typeChip).join('')}</div>
      </div>
      <div class="rc-tags">${badge}</div>
    </div>`;
  }).join('');
  el.querySelectorAll('.result-card').forEach(card => {
    card.addEventListener('click', () => openDetail(card.dataset.id));
  });
}

function search(query){
  const q = normalize(query);
  if (!q){
    document.getElementById('searchHint').textContent = `${POKEDEX.length} Pokémon na base`;
    return [];
  }
  const isNum = /^\d+$/.test(q);
  const scored = [];
  for (const p of POKEDEX){
    const n = normalize(p.name);
    let score = -1;
    if (isNum){
      if (String(p.dex) === q) score = 100;
    } else if (n === q) score = 100;
    else if (n.startsWith(q)) score = 80;
    else if (n.includes(q)) score = 50;
    if (score > 0) scored.push({ p, score });
  }
  scored.sort((a,b) => b.score - a.score || a.p.dex - b.p.dex);
  document.getElementById('searchHint').textContent = `${scored.length} resultado(s)`;
  return scored.map(s => s.p);
}

function evoChainHtml(entry){
  // monta a cadeia completa a partir da forma base conhecida
  let root = entry;
  const seen = new Set();
  while (root.evoFrom && !seen.has(root.id)){
    seen.add(root.id);
    const prev = BY_ID[root.evoFrom];
    if (!prev) break;
    root = prev;
  }
  const nodes = [];
  function walk(node, isCurrent){
    nodes.push({ node, isCurrent });
    if (node.evoTo.length){
      // segue só a primeira ramificação em linha, outras aparecem como nós irmãos simples
      node.evoTo.forEach((edge, i) => {
        const next = BY_ID[edge.id];
        if (!next) return;
        if (i === 0) walk(next, next.id === entry.id);
      });
    }
  }
  walk(root, root.id === entry.id);

  let html = '';
  nodes.forEach((n, i) => {
    if (i > 0){
      const edge = n.node.evoFrom ? BY_ID[n.node.evoFrom].evoTo.find(e => e.id === n.node.id) : null;
      const candyTxt = edge && typeof edge.candy === 'number' ? `${edge.candy} 🍬` : '';
      html += `<div class="evo-arrow">→<small>${candyTxt}</small></div>`;
    }
    html += `<div class="evo-node${n.isCurrent ? ' current' : ''}" data-id="${n.node.id}">${n.node.name}</div>`;
  });
  return html;
}

function verdictBadge(verdict, text){
  const cls = verdict === 'good' ? 'good' : (verdict === 'mid' || verdict === 'neutral' ? 'mid' : 'bad');
  const icon = verdict === 'good' ? '✅' : (verdict === 'mid' || verdict === 'neutral' ? '➖' : '❌');
  return `<div class="verdict ${cls}">${icon} ${text}</div>`;
}

function renderDetail(entry){
  document.getElementById('detailTitle').textContent = entry.name;
  const evo = evolveAdvice(entry);
  const pvp = pvpAdvice(entry);
  const raid = raidAdvice(entry);
  const candy = candyAdvice(entry);

  let pvpHtml = '';
  if (pvp.hasData){
    pvpHtml = verdictBadge(pvp.verdict, pvp.label) + pvp.leagues.map(l => {
      const score = entry.pvp[l];
      return `<div class="league-row">
        <div class="league-name">${LEAGUE_LABEL[l]}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${score}%"></div></div>
        <div class="league-score">${score.toFixed(0)}</div>
      </div>`;
    }).join('') + `<p style="margin-top:.4rem">Ligas mostradas: apenas as em que ele tem CP relevante (Great = ${LEAGUE_CAP.great}, Ultra = ${LEAGUE_CAP.ultra}, Master = ${LEAGUE_CAP.master}).</p>`;
  } else {
    pvpHtml = verdictBadge('bad', 'Sem relevância em PvP') + `<p>Esse Pokémon não figura entre as opções competitivas em nenhuma liga.</p>`;
  }

  let raidHtml = '';
  if (raid.hasData){
    raidHtml = verdictBadge(raid.verdict, raid.label) +
      `<div class="raid-type-row">
        <div class="tier-badge ${raid.best.tier}">${raid.best.tier}</div>
        <div class="rt-info">Atacante de <b>${TYPE_PT[raid.best.type] || raid.best.type}</b> — ${raid.best.rank}º de ${raid.best.total} nesse tipo</div>
      </div>`;
  } else {
    raidHtml = verdictBadge('bad', 'Sem dados de raid') + `<p>Não foi possível calcular um golpe eficiente para esse Pokémon.</p>`;
  }

  document.getElementById('detailBody').innerHTML = `
    <div class="detail-top">
      <div class="detail-badge" style="${dexBadgeStyle(entry)}">#${entry.dex}</div>
      <div>
        <div class="detail-name">${entry.name}</div>
        <div class="detail-dex">Nº ${entry.dex} · ${(entry.tags||[]).includes('legendary') ? 'Lendário' : (entry.tags||[]).includes('mythical') ? 'Mítico' : (entry.tags||[]).includes('regional') ? 'Regional' : 'Comum'}</div>
        <div class="detail-types">${entry.types.map(typeChip).join('')}</div>
      </div>
    </div>

    <div class="stats-row">
      <div class="stat-box"><div class="v">${entry.atk}</div><div class="l">Ataque</div></div>
      <div class="stat-box"><div class="v">${entry.def}</div><div class="l">Defesa</div></div>
      <div class="stat-box"><div class="v">${entry.hp}</div><div class="l">Vida</div></div>
    </div>

    <div class="evo-chain">${evoChainHtml(entry)}</div>

    <div class="card">
      <h3>🧬 Evoluir?</h3>
      ${verdictBadge(evo.verdict, evo.title)}
      <p>${evo.text}</p>
    </div>

    <div class="card">
      <h3>⚔️ PvP (contra jogadores)</h3>
      ${pvpHtml}
    </div>

    <div class="card">
      <h3>🛡️ Raids</h3>
      ${raidHtml}
    </div>

    <div class="card">
      <h3>🍬 Vale gastar doce?</h3>
      ${verdictBadge(candy.verdict, candy.verdict === 'good' ? 'Vale investir' : candy.verdict === 'mid' ? 'Opcional' : 'Não é prioridade')}
      <p>${candy.text}</p>
    </div>

    <p class="disclaimer">Recomendação baseada em desempenho competitivo (PvP e raids) calculado a partir dos stats do jogo. Pokémon raro, de coleção ou para completar a Pokédex pode valer a pena por outros motivos.</p>
  `;

  document.getElementById('detailBody').querySelectorAll('.evo-node').forEach(node => {
    node.addEventListener('click', () => openDetail(node.dataset.id));
  });
}

function openDetail(id){
  const entry = BY_ID[id];
  if (!entry) return;
  renderDetail(entry);
  document.getElementById('detail').classList.add('on');
  document.getElementById('detailBody').scrollTop = 0;
  history.pushState({ pgDetail: id }, '', '#' + id);
}
function closeDetail(){
  document.getElementById('detail').classList.remove('on');
  if (location.hash) history.pushState({}, '', location.pathname);
}

// ---------------- Init ----------------

document.getElementById('searchInput').addEventListener('input', e => {
  renderResults(search(e.target.value));
});
document.getElementById('closeDetail').addEventListener('click', closeDetail);
window.addEventListener('popstate', e => {
  if (e.state && e.state.pgDetail) openDetail(e.state.pgDetail);
  else closeDetail();
});

document.getElementById('searchHint').textContent = `${POKEDEX.length} Pokémon na base — digite um nome`;

if (location.hash){
  const id = location.hash.slice(1);
  if (BY_ID[id]) openDetail(id);
}

if ('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
