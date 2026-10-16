import { FILM_CREDITS, splitCreditNames } from "./filmCredits.js";

/** Last name of the first person credited, lowercased for sorting. */
function getCreditSortName(credit) {
  const [firstName = ""] = splitCreditNames(credit);
  const parts = firstName.split(/\s+/);
  return (parts[parts.length - 1] || "").toLowerCase();
}

function safeYear(year) {
  const n = Number(year);
  return Number.isFinite(n) ? n : null;
}

/** Every distinct person named in one credit field (e.g. "writer") across films. */
export function getFilmCreditNames(films, field) {
  const names = new Set(films.flatMap((film) => splitCreditNames(film[field])));
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

export function getFilmYears(films) {
  const years = Array.from(
    new Set(films.map((m) => safeYear(m.year)).filter((value) => value !== null))
  );
  years.sort((a, b) => b - a);
  return years;
}

function getFilmRecencyValue(film) {
  const time = Date.parse(film?.created_at);
  return Number.isFinite(time) ? time : 0;
}

/**
 * Picks the homepage preview set: the most recently created films, with the
 * API's order breaking ties.
 */
export function getRecentFilms(films, limit = 3) {
  return [...(Array.isArray(films) ? films : [])]
    .map((film, index) => ({ film, index }))
    .sort((a, b) => {
      const byRecency = getFilmRecencyValue(b.film) - getFilmRecencyValue(a.film);
      return byRecency || a.index - b.index;
    })
    .slice(0, limit)
    .map(({ film }) => film);
}

/** Sorts by credited last name; films without the credit stay last either way. */
function sortByCredit(list, field, direction) {
  list.sort((a, b) => {
    const aName = getCreditSortName(a[field]);
    const bName = getCreditSortName(b[field]);
    if (!aName || !bName) return Number(!aName) - Number(!bName);
    return direction * aName.localeCompare(bName);
  });
}

/**
 * Applies the archive page's stable filter/sort rules without mutating the
 * source film array. `credits` maps a credit field to a selected name or "all".
 */
export function filterAndSortFilms(films, { query = "", credits = {}, year = "all", sort = "az" }) {
  const q = query.trim().toLowerCase();

  const filtered = films.filter((film) => {
    const matchesTitle = String(film.title || "").toLowerCase().includes(q);
    const matchesCredits = FILM_CREDITS.every(({ field }) => {
      const selected = credits[field] ?? "all";
      return selected === "all" || splitCreditNames(film[field]).includes(selected);
    });
    const matchesYear = year === "all" || String(film.year) === String(year);
    return matchesTitle && matchesCredits && matchesYear;
  });

  const list = [...filtered];

  switch (sort) {
    case "az":
      list.sort((a, b) => String(a.title).localeCompare(String(b.title)));
      break;
    case "za":
      list.sort((a, b) => String(b.title).localeCompare(String(a.title)));
      break;
    case "newest":
      list.sort((a, b) => (safeYear(b.year) ?? -1) - (safeYear(a.year) ?? -1));
      break;
    case "oldest":
      list.sort((a, b) => (safeYear(a.year) ?? 9999) - (safeYear(b.year) ?? 9999));
      break;
    default: {
      // Credit sorts use "<field>az" / "<field>za", e.g. "writeraz".
      const credit = FILM_CREDITS.find(({ field }) => sort === `${field}az` || sort === `${field}za`);
      if (credit) sortByCredit(list, credit.field, sort.endsWith("za") ? -1 : 1);
      break;
    }
  }

  return list;
}
