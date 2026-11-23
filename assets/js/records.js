// Every kind of record WildlifeNL keeps that has no page of its own: where it is read, what
// a list of it shows and what it links to. One generic list page and one generic record page
// (pages/records.js) draw all of them from these descriptions, so a link between two records
// in the data is a link in the app.

import { SCOPES } from "./api.js";
import { detections, loadDetections, loadOwnReports } from "./detections.js";
import { buildHash, experimentStatus } from "./lib.js";
import { loadPeople, people, personName } from "./people.js";
import { account, hasScope } from "./session.js";

/** The address of a list (`#/data/species`) or of one record (`#/data/species/{id}`). */
export function recordHash(type, id = "") {
  if (type === "animals") return buildHash("animals", id); // animals have pages of their own
  return `#/data/${type}${id === "" || id == null ? "" : `/${encodeURIComponent(id)}`}`;
}

const DAY = 24 * 3600 * 1000;

/** Visits per cell of a living lab over the last 30 days, the busiest first. */
async function visits(lab) {
  const query = new URLSearchParams({ start: new Date(Date.now() - 30 * DAY).toISOString(), end: new Date().toISOString(), livingLabID: lab.ID, cellSize: 250 });
  const answer = await account.api.call("GET", `/visitation/?${query}`);
  return ((answer && answer.cells) || []).map((cell) => ({ count: cell.count, location: cell.centroid })).sort((a, b) => b.count - a.count);
}

/** Reports found on the map plus the ones the account made itself. */
async function reports() {
  await loadDetections();
  await loadOwnReports();
  return [...detections.reports.values()];
}

/** A list that the people module has read: the account's own, or every experiment's. */
const fromPeople = (pick) => async () => {
  await loadPeople();
  return pick();
};

/** The people the app knows of: every account for an administrator, else whoever was
 * recorded somewhere or named in another record. */
async function knownPeople() {
  await loadPeople();
  const all = new Map();
  if (hasScope(SCOPES.profiles)) for (const profile of await account.api.list("/profiles/")) all.set(String(profile.ID), profile);
  else {
    // every account may read its own profile
    const mine = await account.api.profile();
    if (mine && mine.ID) all.set(String(mine.ID), mine);
  }
  for (const [key, record] of seen) if (key.startsWith("people|") && !all.has(String(record.ID))) all.set(String(record.ID), record);
  for (const id of [...people.tracks.keys(), ...people.names.keys()]) if (id && !all.has(String(id))) all.set(String(id), { ID: id, name: personName(id) });
  return [...all.values()].map((person) => ({ ...person, positions: (people.tracks.get(person.ID) || []).length || "" }));
}

const ofPerson = (list) => (record) => list().filter((item) => item.user && String(item.user.ID) === String(record.ID));

/** A list under an experiment. `call` names the call, so the list is left out on a server
 * that does not have it. */
const research = (path) => ({ needs: SCOPES.research, call: `/${path}/experiment/{id}`, load: (record) => account.api.list(`/${path}/experiment/${record.ID}`) });

/**
 * The kinds of records, by the word in the address.
 * - `table` is the name in the API, `nav` the entry of the navigation it belongs under.
 * - `needs` are the roles for the list (none: every account); `ownOnly` says a `list` gives
 *   an account without them only its own records.
 * - `mine` is where the account's own records are read, for the list `?mine=1`; `own` says
 *   the list holds nothing but the account's own.
 * - `get` reads one record in full, `getNeeds` are its roles.
 * - `columns` are the fields of the list, `labels` names for the ones whose own name says
 *   too little, `title` the name of one record.
 * - `shape(record)` adds what the app works out about a record, such as the state of an
 *   experiment.
 * - `related` are lists that hang under one record, each with its type and loader.
 * - `people` says the list and the lists under a record come from what people.js read,
 *   which a refresh reads again first.
 */
export const TYPES = {
  species: {
    table: "Species",
    label: "Species",
    plural: "Species",
    nav: "species",
    description: "The kinds of animals WildlifeNL knows, with advice for people who meet one",
    path: "/species/",
    get: (id) => `/species/${id}`,
    columns: ["commonName", "name", "category"],
    title: (record) => record.commonName || record.name,
  },
  livinglabs: {
    table: "LivingLab",
    label: "Living lab",
    plural: "Living labs",
    nav: "livinglabs",
    description: "The research areas, each with its boundary",
    path: "/livinglabs/",
    get: (id) => `/livinglab/${id}`,
    columns: ["name", "definition"],
    related: [{ label: "Visits per 250 m cell, last 30 days", needs: SCOPES.visits, load: visits, columns: ["count", "location"], onMap: true }],
  },
  zones: {
    table: "Zone",
    label: "Zone",
    plural: "Zones",
    own: true,
    nav: "zones",
    description: "The areas you drew to be warned about certain species",
    path: "/zones/me/",
    needs: SCOPES.zones,
    columns: ["name", "species", "created", "deactivated"],
  },
  reports: {
    table: "Interaction",
    label: "Report",
    plural: "Reports",
    nav: "reports",
    description: "What people reported: a sighting, damage or a collision with an animal",
    list: reports,
    needs: SCOPES.reports,
    ownOnly: true,
    mine: "/interactions/me/",
    get: (id) => `/interaction/${id}`,
    getNeeds: SCOPES.report,
    columns: ["moment", "type", "species", "notes", "user", "place"],
    title: (record) => [record.type && record.type.name, record.species && (record.species.commonName || record.species.name)].filter(Boolean).join(": ") || "Report",
    hint: "Reports are found like detections: WildlifeNL answers within 10 km of a point, so search an area under Layers on the live map. Your own reports are always listed.",
  },
  "report-types": {
    table: "InteractionType",
    label: "Report type",
    plural: "Report types",
    nav: "report-types",
    description: "The kinds of reports people can make",
    path: "/interactionTypes/",
    columns: ["name", "description"],
  },
  alarms: {
    table: "Alarm",
    label: "Alarm",
    plural: "Alarms",
    nav: "alarms",
    description: "An animal, a detection or a report came inside a zone",
    list: fromPeople(() => people.alarms),
    people: true,
    needs: SCOPES.alarms,
    ownOnly: true,
    mine: "/alarms/me/",
    columns: ["timestamp", "zone", "animal", "detection", "interaction", "conveyances"],
    title: (record) => `Alarm in ${(record.zone && record.zone.name) || "a zone"}`,
  },
  experiments: {
    table: "Experiment",
    label: "Experiment",
    plural: "Experiments",
    nav: "experiments",
    description: "The studies, each in a living lab, with their questionnaires and messages",
    path: "/experiments/",
    needs: SCOPES.research,
    mine: "/experiments/me/",
    get: (id) => `/experiment/${id}`,
    getNeeds: SCOPES.research,
    columns: ["name", "status", "livingLab", "start", "end", "numberOfQuestionnaires", "numberOfMessages", "questionnaireActivity", "messageActivity", "user"],
    labels: { numberOfQuestionnaires: "Questionnaires", numberOfMessages: "Messages", questionnaireActivity: "Questionnaires answered", messageActivity: "Messages sent", user: "Owner" },
    shape: (record) => ({ ...record, status: experimentStatus(record) }),
    related: [
      { label: "Questionnaires", type: "questionnaires", ...research("questionnaires"), columns: ["name", "identifier", "interactionType"] },
      { label: "Messages", type: "messages", ...research("messages"), columns: ["name", "severity", "species", "text"] },
      { label: "Reports", type: "reports", ...research("interactions"), columns: ["moment", "type", "species", "user"] },
      { label: "Responses", type: "responses", ...research("responses"), columns: ["timestamp", "question", "answer", "text"] },
      { label: "Sent messages", type: "conveyances", ...research("conveyances"), columns: ["timestamp", "message", "user", "animal"] },
      { label: "Contacts", type: "contacts", ...research("contacts"), columns: ["start", "end", "user", "borneSensorDeployment"] },
      { label: "Tracking readings", type: "tracking", ...research("tracking-readings"), columns: ["timestamp", "userID", "location"] },
    ],
  },
  questionnaires: {
    table: "Questionnaire",
    label: "Questionnaire",
    plural: "Questionnaires",
    nav: "experiments",
    description: "A list of questions that belongs to an experiment",
    get: (id) => `/questionnaire/${id}`,
    columns: ["name", "identifier", "experiment", "interactionType"],
    related: [{ label: "Responses", type: "responses", needs: SCOPES.research, load: (record) => account.api.list(`/responses/questionnaire/${record.ID}`), columns: ["timestamp", "question", "answer", "text"] }],
  },
  questions: { table: "Question", label: "Question", plural: "Questions", nav: "experiments", description: "One question of a questionnaire", get: (id) => `/question/${id}`, columns: ["index", "text", "description"], title: (record) => record.text || "Question" },
  answers: { table: "Answer", label: "Answer option", plural: "Answer options", nav: "experiments", description: "One answer a person can pick", get: (id) => `/answer/${id}`, columns: ["index", "text"], title: (record) => record.text || "Answer" },
  messages: { table: "Message", label: "Message", plural: "Messages", nav: "experiments", description: "A text of an experiment that is shown to people", get: (id) => `/message/${id}`, columns: ["name", "severity", "species", "text"] },
  responses: { table: "Response", label: "Answer you gave", plural: "Answers", own: true, nav: "responses", description: "What you answered to the questions that followed a report", path: "/responses/me/", columns: ["timestamp", "question", "answer", "text"], title: (record) => record.text || (record.answer && record.answer.text) || "Response" },
  conveyances: {
    table: "Conveyance",
    label: "Sent message",
    plural: "Messages",
    nav: "conveyances",
    description: "The messages and alarms that were shown to people, with who got them and why",
    list: fromPeople(() => people.conveyances),
    people: true,
    needs: SCOPES.research,
    ownOnly: true,
    mine: "/conveyances/me/",
    columns: ["timestamp", "user", "message", "alarm", "animal", "response"],
    title: (record) => (record.message && (record.message.name || record.message.text)) || "Sent message",
  },
  contacts: {
    table: "Contact",
    label: "Contact",
    plural: "Contacts",
    nav: "contacts",
    description: "A person's phone was near an animal's sensor for some time",
    list: fromPeople(() => people.contacts),
    people: true,
    needs: SCOPES.research,
    ownOnly: true,
    columns: ["start", "end", "user", "borneSensorDeployment", "startLocation", "conveyances"],
    title: (record) => [record.user && record.user.name, record.borneSensorDeployment && record.borneSensorDeployment.animal && record.borneSensorDeployment.animal.identifier].filter(Boolean).join(" and ") || "Contact",
  },
  tracking: {
    table: "TrackingReading",
    label: "Tracking reading",
    plural: "Tracking readings",
    nav: "people",
    description: "Where the recreation app recorded people",
    list: fromPeople(() => [...people.tracks.values()].flat().map((point) => point.raw)),
    people: true,
    needs: SCOPES.research,
    ownOnly: true,
    columns: ["timestamp", "userID", "location"],
    title: () => "Tracking reading",
  },
  people: {
    table: "Profile",
    label: "Person",
    plural: "People",
    nav: "people",
    description: "The people the app knows of, with their profile where you may read it: recorded by the recreation app, or named in a report, a contact or a message",
    list: knownPeople,
    people: true,
    needs: SCOPES.profiles,
    ownOnly: true,
    // the profile of anyone for an administrator and the own one for every account; of
    // other people only the name
    get: (id) => (hasScope(SCOPES.profiles) ? `/profile/${id}` : String(id) === String(account.session.userID) ? "/profile/me/" : `/user/${id}`),
    columns: ["name", "email", "roles", "gender", "dateOfBirth", "postcode", "natureVisitAvgWeeklyFrequency", "positions"],
    related: [
      { label: "Where the recreation app recorded this person", load: (record) => (people.tracks.get(record.ID) || []).map((point) => point.raw).reverse(), columns: ["timestamp", "location"], onMap: true },
      { label: "Contacts with animals", type: "contacts", load: ofPerson(() => people.contacts), columns: ["start", "end", "borneSensorDeployment", "startLocation"] },
      { label: "Messages received", type: "conveyances", load: ofPerson(() => people.conveyances), columns: ["timestamp", "message", "alarm", "animal"] },
      { label: "Reports made", type: "reports", load: ofPerson(() => [...detections.reports.values()]), columns: ["moment", "type", "species", "notes"] },
    ],
    hint: "Only administrators see every account and every profile. Others see their own profile and the names of the people in the data they may read.",
  },
  roles: { table: "Role", label: "Role", plural: "Roles", nav: "roles", description: "What an account may do", path: "/roles/", columns: ["name"] },
};

/** Which kind of record a field holds, by the name of the field in the API. */
const FIELD_TYPES = {
  species: "species",
  user: "people",
  livingLab: "livinglabs",
  zone: "zones",
  interaction: "reports",
  interactions: "reports",
  type: "report-types",
  interactionType: "report-types",
  alarm: "alarms",
  experiment: "experiments",
  questionnaire: "questionnaires",
  question: "questions",
  questions: "questions",
  answer: "answers",
  answers: "answers",
  message: "messages",
  response: "responses",
  conveyance: "conveyances",
  conveyances: "conveyances",
  roles: "roles",
};

/** The page of a table of the Database drawing: a list of records, or a page that exists. */
export function tableHash(table) {
  const own = { Animal: buildHash("animals"), BorneSensorDeployment: buildHash("sensors"), BorneSensorReading: buildHash("sensors"), Detection: buildHash("detections"), Credential: buildHash("account"), User: recordHash("people"), Visitation: recordHash("livinglabs") };
  if (own[table]) return own[table];
  const type = Object.keys(TYPES).find((key) => TYPES[key].table === table);
  return type ? recordHash(type) : "";
}

/** A record that is seen anywhere is kept, so its page can show it without a request. */
const seen = new Map();

function idOf(record) {
  return record && (typeof record.ID === "string" || typeof record.ID === "number") ? String(record.ID) : "";
}

function keep(type, record) {
  const id = idOf(record);
  if (!id) return;
  const key = `${type}|${id}`;
  const merged = { ...(seen.get(key) || {}), ...record };
  seen.set(key, TYPES[type].shape ? TYPES[type].shape(merged) : merged);
  for (const [field, value] of Object.entries(record)) {
    const inner = FIELD_TYPES[field];
    if (inner) for (const item of [].concat(value || [])) if (item && typeof item === "object") keep(inner, item);
  }
}

/** Drops what is remembered of a record, so the next read asks WildlifeNL again. */
export function forget(type, id) {
  seen.delete(`${type}|${id}`);
}

/** Remembers a record as WildlifeNL returned it after a change, in place of what was known. */
export function remember(type, record) {
  forget(type, idOf(record));
  keep(type, record);
}

/** Where a field points: `{href, text}` for a link, or null when it is no link. */
export function linkOf(field, value) {
  if (value == null || value === "") return null;
  if (field === "sensorID" && typeof value === "string") return { href: buildHash("sensors", value), text: value };
  if (field === "userID" && typeof value === "string") return { href: recordHash("people", value), text: personName(value) };
  if (field === "deploymentID" && typeof value === "string") return { href: buildHash("detections", "", { detector: value }), text: value };
  if (field === "detection" && idOf(value)) return { href: buildHash("detections", "", { detector: value.deploymentID }), text: `Detection at ${value.deploymentID || "a detector"}` };
  if (field === "borneSensorDeployment" && value.sensorID) return { href: buildHash("sensors", value.sensorID), text: value.sensorID };
  if ((field === "animal" || field === "animals") && idOf(value)) return { href: buildHash("animals", idOf(value)), text: value.identifier || "Animal" };
  const type = FIELD_TYPES[field];
  if (!type || typeof value !== "object" || !idOf(value)) return null;
  return { href: recordHash(type, idOf(value)), text: titleOf(type, value) };
}

export function titleOf(type, record) {
  const def = TYPES[type];
  return (def.title && def.title(record)) || record.name || record.commonName || record.text || `${def.label} ${idOf(record)}`;
}

/** Whether the account may read the list of a kind, in full or only its own. */
export function canList(type) {
  const def = TYPES[type];
  return Boolean(def.list || (def.path && hasScope(def.needs || [])));
}

/** The name of a list: of every record of a kind, or of the account's own. */
export function listTitle(type, mine = false) {
  const { plural, own } = TYPES[type];
  return mine || own ? `My ${plural.toLowerCase()}` : plural;
}

/** Whether the account reads its own records of a kind and not those of everyone. */
export function seesOwnOnly(type) {
  const def = TYPES[type];
  return Boolean(def.mine) && !hasScope(def.needs || []);
}

/** The address of the list a record belongs to. */
export function listHash(type) {
  return recordHash(type) + (seesOwnOnly(type) ? "?mine=1" : "");
}

/** The records of a kind and whether the account sees only its own; `mine` asks for the
 * own ones where the kind has a list of them. */
export async function listRecords(type, mine = false) {
  const def = TYPES[type];
  const all = hasScope(def.needs || []);
  let records;
  if (mine && def.mine) records = await account.api.list(def.mine);
  else if (def.list) records = await def.list();
  else if (def.path && all) records = await account.api.list(def.path);
  else records = [...seen.entries()].filter(([key]) => key.startsWith(`${type}|`)).map(([, record]) => record);
  for (const record of records) keep(type, record);
  // the records as they are kept, with what the app works out about them
  if (def.shape) records = records.map((record) => seen.get(`${type}|${idOf(record)}`) || record);
  return { records, own: Boolean((mine && def.mine) || (def.ownOnly && !all)) };
}

/** One record: read in full when the account may, else what was seen of it elsewhere.
 * `fresh` reads the list it was seen in again when there is no call for one record. */
export async function getRecord(type, id, fresh = false) {
  const def = TYPES[type];
  const known = seen.get(`${type}|${id}`) || null;
  if (def.get && hasScope(def.getNeeds || [])) {
    try {
      const record = await account.api.call("GET", def.get(id));
      if (record) keep(type, record);
    } catch (error) {
      if (error.status === 401 || !known) throw error;
    }
  } else if ((!known || fresh) && (def.list || def.path)) {
    await listRecords(type);
  }
  return seen.get(`${type}|${id}`) || null;
}

export async function relatedRecords(relation, record) {
  await loadPeople();
  const rows = await relation.load(record);
  if (relation.type) for (const row of rows) keep(relation.type, row);
  return rows;
}

/** Forgets the records of the account that signed out. */
export function resetRecords() {
  seen.clear();
}
