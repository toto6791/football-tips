/*
 * Извлича прогнозите „Our tip“ от futbol24.com и ги записва в tips.json.
 * Пуска се автоматично от GitHub Actions (виж .github/workflows/update-tips.yml).
 *
 * Как работи:
 *   1. Отваря страниците с мачове за днес, утре, вдругиден и след 3 дни.
 *   2. За всеки мач отваря страницата с прогнозата и взима „Our tip“ и коефициента.
 *      От таблицата с класирането на същата страница изчислява вероятността
 *      за над/под 2.5 гола (виж „Вероятност за над/под“ по-долу).
 *   3. Записва всичко в tips.json, който приложението чете.
 *
 * За да не натоварва сайта, отваря страниците една по една с пауза между тях
 * и не проверява отново мачове, чиято прогноза е взета скоро.
 *
 * Пускане на компютър:  node scraper/scrape.mjs site/tips.json
 */

import fs from "node:fs/promises";

/* ---- Настройки ---- */

const BASE = process.env.F24_BASE || "https://www.futbol24.com/betting-tips/";
const LIST_PAGES = ["", "tomorrow-football/", "day-after-tomorrow-football/", "in-3-days/"];
const OUT_FILE = process.argv[2] || "site/tips.json";

const PAUSE_MS = 1200; // пауза между заявките към сайта
const MAX_DETAIL_PAGES = Number(process.env.MAX_DETAIL || 90); // най-много страници с прогнози на едно пускане
const RECHECK_HOURS = 6; // след колко часа да се провери отново прогноза на мач, който още не е започнал
const KEEP_PAST_HOURS = 30; // колко часа след началото мачът остава в списъка

const USER_AGENT =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";

/* ---- Помощни функции ---- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.8" },
      });
      if (res.ok) return await res.text();
      if (res.status === 404) return null;
      console.warn(`  ${res.status} за ${url} (опит ${attempt})`);
    } catch (e) {
      console.warn(`  грешка за ${url}: ${e.message} (опит ${attempt})`);
    }
    await sleep(3000 * attempt);
  }
  return null;
}

const ACCENTS = { acute: "\u0301", grave: "\u0300", circ: "\u0302", uml: "\u0308", tilde: "\u0303", cedil: "\u0327", ring: "\u030A", caron: "\u030C" };

// HTML символи → нормален текст: &amp; → &
function decodeEntities(s) {
  return String(s || "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    // букви със знаци: &ccedil; → ç, &eacute; → é
    .replace(/&([a-z])(acute|grave|circ|uml|tilde|cedil|ring|caron);/gi, (_, l, mark) =>
      (l + ACCENTS[mark.toLowerCase()]).normalize("NFC"),
    )
    .replace(/&szlig;/g, "ß")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// HTML → чист текст на един ред
function textOf(html) {
  return decodeEntities(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

// Адрес на мач: .../preview/13-10-2026-arsenal-fc-lille-osc-betting-tip/
const PREVIEW_RE = /^(\d{2})-(\d{2})-(\d{4})-[a-z0-9-]+-betting-tip(?:-\d+)?$/;

/* ---- Страница със списък на мачове ---- */

function parseListPage(html) {
  const found = [];

  // заглавията на лигите и къде се намират в страницата
  const headings = [...html.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)].map((m) => ({
    at: m.index,
    text: cleanLeague(textOf(m[1])),
  }));

  const linkRe = /<a\b[^>]*href="(?:https?:\/\/www\.futbol24\.com)?\/betting-tips\/preview\/([^"#?]+?)\/?"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of html.matchAll(linkRe)) {
    const slug = m[1];
    if (!PREVIEW_RE.test(slug)) continue;
    const inner = m[2];

    const time = (textOf(inner).match(/\b(\d{1,2}):(\d{2})\b/) || []).slice(1);
    const names = [...inner.matchAll(/\btitle="([^"]+)"/g)].map((x) => decodeEntities(x[1]).trim());
    const heading = headings.filter((h) => h.at < m.index).pop();

    found.push({
      id: slug,
      time: time.length ? `${time[0].padStart(2, "0")}:${time[1]}` : "",
      home: names[0] || "",
      away: names[1] || "",
      league: heading ? heading.text : "",
    });
  }
  return found;
}

// „International International - UEFA Champions League“ → „International - UEFA Champions League“
function cleanLeague(text) {
  return text.replace(/^(.+?)\s+\1(\s+-\s+)/, "$1$2").trim();
}

/* ---- Вероятност за над/под ---- */

// Колко изиграни мача „на заем“ от средното за лигата получава всеки отбор.
// Така отбор с малко мачове не получава крайни стойности.
const PRIOR_GAMES = 6;
const LEAGUE_PRIOR_GAMES = 20;
const OU_LINES = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5]; // линиите за над/под

// Име на отбор за сравнение: „Fenerbahçe“ → „fenerbahce“
function teamKey(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Таблиците с класиране от страницата: [{ name, mp, gf, ga }, …]
function parseStandings(html) {
  const tables = [];
  for (const t of html.matchAll(/<table\b[\s\S]*?<\/table>/gi)) {
    const rows = [...t[0].matchAll(/<tr\b[\s\S]*?<\/tr>/gi)].map((r) =>
      [...r[0].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => textOf(c[1])),
    );
    const head = rows.find((r) => r.includes("GF") && r.includes("GA"));
    if (!head) continue;
    const col = (n) => head.indexOf(n);
    const [iTeam, iMp, iGf, iGa] = [col("TEAM"), col("MP"), col("GF"), col("GA")];
    if ([iTeam, iMp, iGf, iGa].includes(-1)) continue;

    const teams = rows
      .filter((r) => r !== head && r.length > iGa)
      .map((r) => ({ name: r[iTeam], mp: +r[iMp], gf: +r[iGf], ga: +r[iGa] }))
      .filter((r) => r.name && [r.mp, r.gf, r.ga].every(Number.isFinite));
    if (teams.length) tables.push(teams);
  }
  return tables;
}

// Намира отбора в таблицата: първо точно име, после частично („Liverpool FC“ ↔ „Liverpool“)
function findTeam(table, name) {
  const k = teamKey(name);
  if (!k) return null;
  const exact = table.find((r) => teamKey(r.name) === k);
  if (exact) return exact;
  // в клетката понякога името стои два пъти: „Aston Villa Aston Villa U19“
  const ends = table.filter((r) => teamKey(r.name).endsWith(" " + k));
  if (ends.length === 1) return ends[0];
  const part = table.filter((r) => teamKey(r.name).includes(k) || k.includes(teamKey(r.name)));
  return part.length === 1 ? part[0] : null;
}

// Вероятност за най-много n гола при средно lambda гола (разпределение на Поасон)
function poissonAtMost(n, lambda) {
  let term = Math.exp(-lambda);
  let sum = term;
  for (let i = 1; i <= n; i++) {
    term *= lambda / i;
    sum += term;
  }
  return sum;
}

/*
 * Изчислява вероятността за над/под 2.5 гола от класирането:
 *   1. Средно голове на отбор в мач за лигата (от цялата таблица).
 *   2. Атака и защита на двата отбора (вкарани и допуснати на мач),
 *      смесени с PRIOR_GAMES мача на средното ниво за лигата.
 *   3. Очаквани голове = атака на домакина × защита на госта ÷ средното
 *      + атака на госта × защита на домакина ÷ средното.
 *   4. Вероятност по Поасон за брой голове под линията → „под“, останалото → „над“
 *      (за 2.5: 0, 1 или 2 гола → „под“). Смята се за всички линии от OU_LINES.
 * Връща null, ако двата отбора не са в една таблица.
 */
function overUnderFromStandings(html, home, away) {
  for (const table of parseStandings(html)) {
    const h = findTeam(table, home);
    const a = findTeam(table, away);
    if (!h || !a || h === a || h.mp + a.mp === 0) continue;

    // средно голове на отбор в мач за лигата; в началото на сезона се доближава
    // до обичайните 1.35 (около 2.7 гола в мач), докато се натрупат мачове
    const games = table.reduce((s, r) => s + r.mp, 0);
    const goals = table.reduce((s, r) => s + r.gf + r.ga, 0) / 2;
    const avg = (goals + LEAGUE_PRIOR_GAMES * 1.35) / (games + LEAGUE_PRIOR_GAMES);

    const rate = (g, mp) => (g + PRIOR_GAMES * avg) / (mp + PRIOR_GAMES);
    const xgHome = (rate(h.gf, h.mp) * rate(a.ga, a.mp)) / avg;
    const xgAway = (rate(a.gf, a.mp) * rate(h.ga, h.mp)) / avg;
    const xg = Math.min(6, Math.max(0.6, xgHome + xgAway));

    // за всяка линия: процент „под“ и „над“ (сборът винаги е 100)
    const lines = OU_LINES.map((line) => {
      // между 1 и 99: изчислението никога не е сигурно на 100%
      const under = Math.min(99, Math.max(1, Math.round(poissonAtMost(Math.floor(line), xg) * 100)));
      return { line, over: 100 - under, under };
    });
    return {
      lines,
      xg: Math.round(xg * 100) / 100,
      games: Math.min(h.mp, a.mp), // по-малкото изиграни мачове от двата отбора
    };
  }
  return null;
}

/* ---- Страница с прогнозата за един мач ---- */

function parseDetailPage(html) {
  const out = {};

  // „Our tip“ е в адреса на банера: ...conversion-banner/index.html?title=Our+tip&tip=...&odd=1.29
  const banner = html.match(/conversion-banner\/index\.html\?([^"'<>\s]+)/i);
  if (banner) {
    const params = new URLSearchParams(decodeEntities(banner[1]));
    if (params.get("tip")) out.tip = params.get("tip").trim();
    if (params.get("odd")) out.odd = params.get("odd").trim();
  }

  // Резервен вариант: първата удебелена препоръка под „Recommended Betting Tips“
  if (!out.tip) {
    const section = html.split(/Recommended Betting Tips/i)[1];
    const strong = section && section.match(/<strong>([\s\S]*?)<\/strong>/i);
    if (strong) {
      out.tip = textOf(strong[1]);
      out.tipSource = "текст";
    }
  }

  // Отбори от заглавието: „Arsenal FC - Lille OSC betting tip & best odds | 13.10.2026“
  const title = textOf((html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1]);
  const teams = title.split(/ betting tip/i)[0].split(" - ");
  if (teams.length === 2) {
    out.home = teams[0].trim();
    out.away = teams[1].trim();
  }

  // Лига от описанието: „The UEFA Champions League game between …“
  const desc = decodeEntities((html.match(/<meta\s+name="description"\s+content="([^"]*)"/i) || [])[1]);
  const league = desc.match(/^The (.+?) game between/i);
  if (league) out.leagueName = league[1].trim();

  // Час, ако липсва в списъка: „Today 19:00“ или „14.10.2026 19:00“
  const when = textOf(html).match(/\b(?:Today|Tomorrow|\d{2}\.\d{2}\.\d{4})\s+(\d{1,2}:\d{2})\b/);
  if (when) out.time = when[1].padStart(5, "0");

  // Вероятност за над/под 0.5 … 6.5 гола (null, ако няма класиране за двата отбора)
  out.ou = out.home && out.away ? overUnderFromStandings(html, out.home, out.away) : null;

  return out;
}

/* ---- Предишните данни (за да не се проверява всичко наново) ---- */

async function loadPrevious() {
  try {
    return JSON.parse(await fs.readFile(OUT_FILE, "utf8"));
  } catch {}
  // в GitHub Actions: взимаме последната публикувана версия от сайта
  const repo = process.env.GITHUB_REPOSITORY;
  if (repo) {
    const [owner, name] = repo.split("/");
    const site = name.toLowerCase() === `${owner.toLowerCase()}.github.io` ? "" : `${name}/`;
    const url = `https://${owner.toLowerCase()}.github.io/${site}tips.json?t=${Date.now()}`;
    try {
      const res = await fetch(url);
      if (res.ok) {
        console.log("Предишни данни от", url);
        return await res.json();
      }
    } catch {}
  }
  return { matches: [] };
}

/* ---- Главната част ---- */

function kickoffIso(id, time) {
  const [, dd, mm, yyyy] = id.match(PREVIEW_RE);
  // часовете в сайта са по UTC (световно време); приложението ги превръща в местно време
  return `${yyyy}-${mm}-${dd}T${time || "12:00"}:00Z`;
}

async function main() {
  const now = Date.now();
  const previous = await loadPrevious();
  const prevById = new Map((previous.matches || []).map((m) => [m.id, m]));

  // 1. Списъците с мачове
  const listed = new Map();
  for (const page of LIST_PAGES) {
    console.log("Списък:", BASE + page);
    const html = await fetchText(BASE + page);
    if (html) {
      for (const m of parseListPage(html)) {
        const old = listed.get(m.id) || {};
        listed.set(m.id, {
          ...old,
          ...Object.fromEntries(Object.entries(m).filter(([, v]) => v)),
        });
      }
    }
    await sleep(PAUSE_MS);
  }
  console.log(`Намерени мачове: ${listed.size}`);

  if (listed.size === 0) {
    console.error(
      "Не намерих нито един мач. Сайтът може да е недостъпен или да е сменил вида на страниците. Данните остават непроменени.",
    );
    process.exit(1);
  }

  // 2. Сливаме с предишните данни
  const matches = new Map();
  for (const [id, m] of listed) {
    const old = prevById.get(id) || {};
    matches.set(id, {
      ...old,
      id,
      url: `${BASE}preview/${id}/`,
      home: m.home || old.home || "",
      away: m.away || old.away || "",
      league: m.league || old.league || "",
      time: m.time || old.time || "",
    });
  }
  // мачове, които вече не са в списъка, но са били днес, остават известно време
  for (const [id, old] of prevById) {
    if (!matches.has(id) && Date.parse(old.kickoff) > now - KEEP_PAST_HOURS * 3600e3) matches.set(id, old);
  }

  // 3. Кои страници с прогнози да отворим
  const toCheck = [...matches.values()]
    .filter((m) => {
      const kickoff = Date.parse(kickoffIso(m.id, m.time));
      if (kickoff < now - 2 * 3600e3) return false; // мачът отдавна е започнал
      if (!m.tip) return true; // още нямаме прогноза
      // още не е смятана вероятността за над/под или е от старата версия само с 2.5
      if ((!("ou" in m) || (m.ou && !m.ou.lines)) && kickoff > now) return true;
      return now - (m.checkedAt || 0) > RECHECK_HOURS * 3600e3 && kickoff > now;
    })
    .sort((a, b) => kickoffIso(a.id, a.time).localeCompare(kickoffIso(b.id, b.time)))
    .slice(0, MAX_DETAIL_PAGES);

  console.log(`Отварям ${toCheck.length} страници с прогнози…`);
  let withTip = 0;
  for (const m of toCheck) {
    const html = await fetchText(m.url);
    if (html) {
      const d = parseDetailPage(html);
      if (!d.ou && m.home && m.away) d.ou = overUnderFromStandings(html, m.home, m.away);
      Object.assign(m, {
        tip: d.tip || m.tip || "",
        odd: d.odd || m.odd || "",
        home: m.home || d.home || "",
        away: m.away || d.away || "",
        league: m.league || d.leagueName || "",
        time: m.time || d.time || "",
        ou: d.ou || m.ou || null,
        checkedAt: now,
      });
      if (d.tip) withTip++;
    }
    await sleep(PAUSE_MS);
  }
  console.log(`Прогнози намерени: ${withTip} от ${toCheck.length}`);
  console.log(`Вероятност за над/под: ${toCheck.filter((m) => m.ou).length} от ${toCheck.length}`);
  if (toCheck.length >= 5 && withTip === 0) {
    console.warn("ВНИМАНИЕ: нито една прогноза не е намерена. Сайтът може да е сменил вида на страниците.");
  }

  // 4. Записваме
  const list = [...matches.values()]
    .map((m) => ({ ...m, kickoff: kickoffIso(m.id, m.time) }))
    .filter((m) => Date.parse(m.kickoff) > now - KEEP_PAST_HOURS * 3600e3)
    .sort((a, b) => a.kickoff.localeCompare(b.kickoff) || a.league.localeCompare(b.league));

  const result = {
    source: "https://www.futbol24.com/betting-tips/",
    generatedAt: new Date(now).toISOString(),
    count: list.length,
    withTip: list.filter((m) => m.tip).length,
    withOu: list.filter((m) => m.ou).length,
    matches: list,
  };
  await fs.mkdir(OUT_FILE.split("/").slice(0, -1).join("/") || ".", { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(result, null, 1));
  console.log(`Записани ${result.count} мача (${result.withTip} с прогноза) в ${OUT_FILE}`);
}

// Позволява тестване на отделните функции без да се пуска цялата програма
export { parseListPage, parseDetailPage, kickoffIso, cleanLeague, parseStandings, overUnderFromStandings };

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
