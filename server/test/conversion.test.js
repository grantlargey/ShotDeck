import "./helpers/guard.js";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { analyzeLegacy } from "../src/tools/convert-captured-scenes.js";
import { TAGS } from "./helpers/fixtures.js";
import {
    applyLegacySchema,
    connectDatabase,
    createTestDatabase,
    dropTestDatabase,
    restoreDump,
    runServerNode,
} from "./helpers/databases.js";

const COMMAND = "src/tools/convert-captured-scenes.js";
const DUMP_PATH = process.env.LEGACY_DUMP_PATH || "";
const SYNTHETIC_DATABASES = ["convert_ok", "convert_abort", "convert_empty"];
const DUMP_DATABASES = ["dump_unrepaired", "dump_repaired", "dump_fresh"];
const databases = DUMP_PATH ? [...SYNTHETIC_DATABASES, ...DUMP_DATABASES] : SYNTHETIC_DATABASES;

const IDS = {
    movie: "10000000-0000-4000-8000-000000000001",
    script: "20000000-0000-4000-8000-000000000001",
    anchor: "30000000-0000-4000-8000-000000000001",
    scene: "40000000-0000-4000-8000-000000000001",
    legacy: "50000000-0000-4000-8000-000000000001",
    still: "60000000-0000-4000-8000-000000000001",
};

const LOCAL_SCENE_IDS = [
    "0075ae75-93c7-4143-aef6-b4e29574ed20",
    "699a57ac-4d59-4a29-b930-75d064b3072c",
    "e12dfd87-1711-476c-8506-0ea53959272b",
];

function legacyAnchor(kind, { page = 1, line = 0, text = `${kind} text`, ...rest } = {}) {
    return { kind, version: 2, unit: "pt", page, line, top: 100 + line * 12, bottom: 112 + line * 12, text, ...rest };
}

function legacyPair({ page = 1, startLine = 0, endLine = startLine + 4 } = {}) {
    return [legacyAnchor("start", { page, line: startLine }), legacyAnchor("end", { page, line: endLine })];
}

function pureFixture(overrides = {}) {
    const anchor = {
        id: IDS.anchor,
        movie_id: IDS.movie,
        script_id: IDS.script,
        formatted_selected_text: "## INT. DINER - NIGHT\n\nAction.",
        raw_selected_text: "INT. DINER - NIGHT\nAction.",
        anchor_geometry: legacyPair(),
        ...overrides.anchor,
    };
    const scene = {
        id: IDS.scene,
        anchor_id: anchor.id,
        movie_id: IDS.movie,
        script_id: IDS.script,
        start_time_seconds: 10,
        end_time_seconds: 20,
        tags: [TAGS.protagonist],
        created_at: new Date("2024-01-01T00:00:00Z"),
        updated_at: new Date("2024-01-02T00:00:00Z"),
        ...overrides.scene,
    };
    return {
        scenes: overrides.scenes ?? [scene],
        anchors: overrides.anchors ?? [anchor],
        scripts: overrides.scripts ?? [{ id: IDS.script, movie_id: IDS.movie }],
        scriptAnnotationCount: overrides.scriptAnnotationCount ?? 0,
        dropped: overrides.dropped ?? { stillsWithTitleOrBody: 0, moviesWithLinks: 0 },
    };
}

function abort(report, reason) {
    return report.aborts.find((entry) => entry.reason === reason);
}

function parseReport(run) {
    assert.ok(run.stdout, run.stderr);
    return JSON.parse(run.stdout);
}

async function seedConvertibleDatabase(suffix, { tags = [TAGS.protagonist] } = {}) {
    const db = await connectDatabase(suffix);
    try {
        await applyLegacySchema(db);
        await db.query(
            `INSERT INTO movies (id, title, director, year, runtime_minutes, links)
             VALUES ($1, 'Night Diner', 'Ada Park', 2024, 118, '["https://example.com"]')`,
            [IDS.movie]
        );
        await db.query("INSERT INTO scripts (id, movie_id, s3_key) VALUES ($1, $2, 'scripts/test.pdf')", [
            IDS.script,
            IDS.movie,
        ]);
        await db.query(
            `INSERT INTO script_scene_anchors (
               id, movie_id, script_id, selected_text, raw_selected_text,
               formatted_selected_text, anchor_geometry, created_at, updated_at
             ) VALUES ($1,$2,$3,'Selected words',$4,$5,$6::jsonb,'2024-01-01','2024-01-02')`,
            [IDS.anchor, IDS.movie, IDS.script, "Raw words exactly\n", "## Scene text exactly\n", JSON.stringify(legacyPair())]
        );
        await db.query(
            `INSERT INTO script_scene_annotations (
               id, anchor_id, movie_id, script_id, start_time_seconds, end_time_seconds, tags, created_at, updated_at
             ) VALUES ($1,$2,$3,$4,10,20,$5::jsonb,'2024-01-03','2024-01-04')`,
            [IDS.scene, IDS.anchor, IDS.movie, IDS.script, JSON.stringify(tags)]
        );
        await db.query(
            `INSERT INTO script_annotations (
               id, movie_id, script_id, start_time_seconds, end_time_seconds,
               selected_text, raw_selected_text, formatted_selected_text, tags
             ) VALUES ($1,$2,$3,30,40,'Legacy','Legacy','Legacy','[]')`,
            [IDS.legacy, IDS.movie, IDS.script]
        );
        await db.query(
            `INSERT INTO annotations (id, movie_id, time_seconds, title, body)
             VALUES ($1,$2,15,'frame.jpg','frame.jpg')`,
            [IDS.still, IDS.movie]
        );
    } finally {
        await db.end();
    }
}

before(async () => {
    for (const suffix of databases) await createTestDatabase(suffix);
    await seedConvertibleDatabase("convert_ok");
    await seedConvertibleDatabase("convert_abort", { tags: ["unknown:tag"] });
    if (DUMP_PATH) {
        await restoreDump("dump_unrepaired", DUMP_PATH);
        await restoreDump("dump_repaired", DUMP_PATH);
    }
});

after(async () => {
    for (const suffix of databases.toReversed()) await dropTestDatabase(suffix);
});

describe("conversion analysis", () => {
    test("copies text and timestamps verbatim, uses the last valid anchor and deduplicates tags", () => {
        const first = legacyAnchor("start", { line: 1, text: "first" });
        const last = legacyAnchor("start", { line: 2, text: "last" });
        const fixture = pureFixture({
            anchor: {
                formatted_selected_text: "  ## Exact scene text\n",
                raw_selected_text: "  Exact raw text\n",
                anchor_geometry: [first, last, legacyAnchor("end", { line: 5 })],
            },
            scene: { tags: [TAGS.protagonist, TAGS.revelation, TAGS.protagonist] },
        });
        const { report, converted } = analyzeLegacy(fixture);
        assert.deepEqual(report.aborts, []);
        assert.equal(converted[0].scene_text, "  ## Exact scene text\n");
        assert.equal(converted[0].raw_text, "  Exact raw text\n");
        assert.equal(converted[0].start.text, "last");
        assert.deepEqual(converted[0].tags, [TAGS.protagonist, TAGS.revelation]);
        assert.equal(converted[0].created_at, fixture.scenes[0].created_at);
        assert.equal(converted[0].updated_at, fixture.scenes[0].updated_at);
    });

    test("classifies every invalid anchor-pair category as unresolved", () => {
        const categories = [
            [],
            [legacyAnchor("start", { line: 10 }), legacyAnchor("end", { line: 2 })],
            [legacyAnchor("start"), { ...legacyAnchor("end"), unit: "px" }],
            [legacyAnchor("start")],
            [{ x: 1, y: 2, width: 3, height: 4 }],
            [{ kind: "start", version: 2, unit: "pt", page: "1", line: 0, top: 1, bottom: 2, text: "x" }],
        ];
        for (const geometry of categories) {
            const { report } = analyzeLegacy(pureFixture({ anchor: { anchor_geometry: geometry } }));
            assert.deepEqual(abort(report, "no_valid_anchor_pair").ids, [IDS.scene]);
        }
    });

    test("reports invalid entries even beside a valid pair", () => {
        const geometry = [...legacyPair(), { kind: "start", version: 2, page: 1, line: 9, top: 1, bottom: 2 }];
        const { report } = analyzeLegacy(pureFixture({ anchor: { anchor_geometry: geometry } }));
        assert.deepEqual(abort(report, "invalid_anchor_entry").ids, [IDS.scene]);
        assert.equal(abort(report, "no_valid_anchor_pair"), undefined);
    });

    test("reports unknown tags by value and scene", () => {
        const { report } = analyzeLegacy(
            pureFixture({ scene: { tags: ["unknown:one", TAGS.protagonist, "unknown:one", "unknown:two"] } })
        );
        assert.deepEqual(abort(report, "unmapped_tag"), {
            reason: "unmapped_tag",
            count: 2,
            values: [
                { tag: "unknown:one", ids: [IDS.scene] },
                { tag: "unknown:two", ids: [IDS.scene] },
            ],
        });
    });

    test("reports film timing and inclusive script-location overlaps only within one script", () => {
        const first = pureFixture();
        const secondId = "40000000-0000-4000-8000-000000000002";
        const secondAnchorId = "30000000-0000-4000-8000-000000000002";
        const secondAnchor = { ...first.anchors[0], id: secondAnchorId, anchor_geometry: legacyPair({ startLine: 4 }) };
        const secondScene = {
            ...first.scenes[0],
            id: secondId,
            anchor_id: secondAnchorId,
            start_time_seconds: 15,
            end_time_seconds: 25,
        };
        const { report } = analyzeLegacy({ ...first, scenes: [...first.scenes, secondScene], anchors: [...first.anchors, secondAnchor] });
        assert.deepEqual(abort(report, "film_timing_overlap").pairs, [[IDS.scene, secondId]]);
        assert.deepEqual(abort(report, "script_location_overlap").pairs, [[IDS.scene, secondId]]);
    });

    test("reports orphans, ownership mismatch, blank text and canonical bounds separately", () => {
        const orphanAnchorId = "30000000-0000-4000-8000-000000000099";
        const { report } = analyzeLegacy(
            pureFixture({
                anchor: {
                    movie_id: "10000000-0000-4000-8000-000000000099",
                    formatted_selected_text: " \n",
                    raw_selected_text: "",
                    anchor_geometry: legacyPair({ page: 100_001 }),
                },
                anchors: undefined,
            })
        );
        assert.deepEqual(abort(report, "script_movie_mismatch").ids, [IDS.scene]);
        assert.deepEqual(abort(report, "blank_scene_text").ids, [IDS.scene]);
        assert.deepEqual(abort(report, "blank_raw_text").ids, [IDS.scene]);
        assert.deepEqual(abort(report, "location_out_of_range").ids, [IDS.scene]);

        const fixture = pureFixture();
        const orphanAnchor = { ...fixture.anchors[0], id: orphanAnchorId };
        const missingAnchorScene = { ...fixture.scenes[0], anchor_id: "30000000-0000-4000-8000-000000000098" };
        const orphans = analyzeLegacy({ ...fixture, scenes: [missingAnchorScene], anchors: [orphanAnchor] }).report;
        assert.deepEqual(abort(orphans, "orphan_scene").ids, [IDS.scene]);
        assert.deepEqual(abort(orphans, "orphan_anchor").ids, [orphanAnchorId]);
    });

    test("counts zero-length timings while preserving the strict overlap rule", () => {
        const fixture = pureFixture({ scene: { start_time_seconds: 15, end_time_seconds: 15 } });
        const { report } = analyzeLegacy(fixture);
        assert.equal(report.film_timing.zero_length, 1);
        assert.equal(abort(report, "film_timing_overlap"), undefined);
    });
});

describe("the conversion command", () => {
    test("--check reads the full conversion without writing", async () => {
        const run = runServerNode(COMMAND, "convert_ok", ["--check"]);
        assert.equal(run.status, 0, run.stderr);
        const report = parseReport(run);
        assert.equal(report.status, "would_convert");
        assert.equal(report.scanned.captured_scenes, 1);
        assert.equal(report.converted.captured_scenes, 0);
        const db = await connectDatabase("convert_ok");
        try {
            const state = await db.query(
                `SELECT to_regclass('public.captured_scenes') AS captured,
                        to_regclass('public.script_scene_annotations') AS legacy`
            );
            assert.equal(state.rows[0].captured, null);
            assert.equal(state.rows[0].legacy, "script_scene_annotations");
        } finally {
            await db.end();
        }
    });

    test("converts once, reconciles, stamps version 1, and never re-imports a deleted scene", async () => {
        const first = runServerNode(COMMAND, "convert_ok");
        assert.equal(first.status, 0, first.stderr);
        const report = parseReport(first);
        assert.equal(report.status, "converted");
        assert.deepEqual(report.scanned, { captured_scenes: 1, script_annotations: 1 });
        assert.equal(report.converted.captured_scenes, 1);
        assert.deepEqual(report.dropped, {
            script_annotations: 1,
            stills_with_title_or_body: 1,
            movies_with_links: 1,
        });

        const db = await connectDatabase("convert_ok");
        try {
            const scene = await db.query("SELECT * FROM captured_scenes WHERE id = $1", [IDS.scene]);
            assert.equal(scene.rows[0].scene_text, "## Scene text exactly\n");
            assert.equal(scene.rows[0].raw_text, "Raw words exactly\n");
            assert.equal(scene.rows[0].created_at.toISOString(), "2024-01-03T00:00:00.000Z");
            assert.equal(scene.rows[0].updated_at.toISOString(), "2024-01-04T00:00:00.000Z");
            const ledger = await db.query("SELECT version, name FROM schema_migrations");
            assert.deepEqual(ledger.rows, [
                { version: 1, name: "0001_canonical_schema (converted from legacy storage)" },
            ]);
            const removed = await db.query(
                `SELECT to_regclass('public.script_annotations') AS annotations,
                        to_regclass('public.script_scene_annotations') AS scenes,
                        to_regclass('public.script_scene_anchors') AS anchors`
            );
            assert.deepEqual(removed.rows[0], { annotations: null, scenes: null, anchors: null });
            await db.query("DELETE FROM captured_scenes WHERE id = $1", [IDS.scene]);
        } finally {
            await db.end();
        }

        const second = runServerNode(COMMAND, "convert_ok");
        assert.equal(second.status, 0, second.stderr);
        assert.equal(parseReport(second).status, "already_converted");
        const check = await connectDatabase("convert_ok");
        try {
            assert.equal((await check.query("SELECT 1 FROM captured_scenes WHERE id = $1", [IDS.scene])).rowCount, 0);
        } finally {
            await check.end();
        }
    });

    test("aborts unresolved records without creating canonical storage", async () => {
        const run = runServerNode(COMMAND, "convert_abort");
        assert.equal(run.status, 3, run.stderr);
        const report = parseReport(run);
        assert.equal(report.status, "aborted");
        assert.equal(abort(report, "unmapped_tag").values[0].tag, "unknown:tag");
        const db = await connectDatabase("convert_abort");
        try {
            const state = await db.query(
                `SELECT to_regclass('public.captured_scenes') AS captured,
                        count(*)::int AS legacy_count FROM script_scene_annotations`
            );
            assert.equal(state.rows[0].captured, null);
            assert.equal(state.rows[0].legacy_count, 1);
        } finally {
            await db.end();
        }
    });

    test("answers not_convertible for an empty database and validates usage", () => {
        const empty = runServerNode(COMMAND, "convert_empty", ["--check"]);
        assert.equal(empty.status, 2, empty.stderr);
        assert.equal(parseReport(empty).status, "not_convertible");
        const usage = runServerNode(COMMAND, "convert_empty", ["--unknown"]);
        assert.equal(usage.status, 1);
        assert.equal(usage.stdout, "");
        assert.match(usage.stderr, /Usage:/);
    });

    test("reports contain no text, object keys, email fields or credentials", () => {
        const run = runServerNode(COMMAND, "convert_abort", ["--check"]);
        const output = run.stdout;
        for (const secret of ["Scene text exactly", "Raw words exactly", "scripts/test.pdf", "password_hash", "email"]) {
            assert.ok(!output.includes(secret), secret);
        }
    });
});

async function applyDumpFixups(db) {
    for (const [index, sceneId] of LOCAL_SCENE_IDS.entries()) {
        const geometry = legacyPair({ page: 90, startLine: index * 10, endLine: index * 10 + 4 });
        await db.query(
            `UPDATE script_scene_anchors
             SET anchor_geometry = $2::jsonb,
                 formatted_selected_text = COALESCE(formatted_selected_text, selected_text)
             WHERE id = (SELECT anchor_id FROM script_scene_annotations WHERE id = $1)`,
            [sceneId, JSON.stringify(geometry)]
        );
    }
    await db.query("UPDATE script_scene_annotations SET tags = '[]'::jsonb WHERE id = ANY($1::uuid[])", [
        LOCAL_SCENE_IDS,
    ]);
    await db.query(
        `UPDATE script_scene_annotations
         SET start_time_seconds = source.end_time_seconds,
             end_time_seconds = source.end_time_seconds + 10
         FROM script_scene_annotations source
         WHERE script_scene_annotations.id = $1 AND source.id = $2`,
        [LOCAL_SCENE_IDS[2], LOCAL_SCENE_IDS[1]]
    );
}

async function catalog(db) {
    const [columns, constraints, indexes] = await Promise.all([
        db.query(
            `SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default,
                    is_generated, generation_expression
             FROM information_schema.columns
             WHERE table_schema = 'public'
             ORDER BY table_name, column_name`
        ),
        db.query(
            `SELECT c.conname, c.contype, rel.relname AS table_name,
                    pg_get_constraintdef(c.oid, true) AS definition
             FROM pg_constraint c
             JOIN pg_class rel ON rel.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = rel.relnamespace
             WHERE n.nspname = 'public'
             ORDER BY table_name, c.conname`
        ),
        db.query(
            `SELECT tablename, indexname, indexdef
             FROM pg_indexes
             WHERE schemaname = 'public'
             ORDER BY tablename, indexname`
        ),
    ]);
    return { columns: columns.rows, constraints: constraints.rows, indexes: indexes.rows };
}

describe("the G2 legacy dump", { skip: !DUMP_PATH && "LEGACY_DUMP_PATH is not set" }, () => {
    test("the unrepaired dump aborts with the approved complete list and leaves no writes", async () => {
        const run = runServerNode(COMMAND, "dump_unrepaired");
        assert.equal(run.status, 3, run.stderr);
        const report = parseReport(run);
        assert.deepEqual(abort(report, "no_valid_anchor_pair").ids, LOCAL_SCENE_IDS);
        assert.deepEqual(abort(report, "film_timing_overlap").pairs, [[LOCAL_SCENE_IDS[1], LOCAL_SCENE_IDS[2]]]);
        assert.deepEqual(abort(report, "blank_scene_text").ids, [LOCAL_SCENE_IDS[0], LOCAL_SCENE_IDS[2]]);
        assert.equal(abort(report, "unmapped_tag").count, 12);
        const db = await connectDatabase("dump_unrepaired");
        try {
            assert.equal((await db.query("SELECT to_regclass('public.captured_scenes') AS name")).rows[0].name, null);
            assert.equal((await db.query("SELECT count(*)::int AS count FROM script_scene_annotations")).rows[0].count, 3);
        } finally {
            await db.end();
        }
    });

    test("the repaired dump converts, reconciles and matches a fresh canonical schema", async () => {
        const repaired = await connectDatabase("dump_repaired");
        try {
            await applyDumpFixups(repaired);
        } finally {
            await repaired.end();
        }
        const run = runServerNode(COMMAND, "dump_repaired");
        assert.equal(run.status, 0, run.stderr);
        const report = parseReport(run);
        assert.equal(report.status, "converted");
        assert.deepEqual(report.scanned, { captured_scenes: 3, script_annotations: 3 });
        assert.equal(report.converted.captured_scenes, 3);
        assert.deepEqual(report.dropped, {
            script_annotations: 3,
            stills_with_title_or_body: 2,
            movies_with_links: 1,
        });
        const convertedDb = await connectDatabase("dump_repaired");
        try {
            const ids = await convertedDb.query("SELECT id FROM captured_scenes ORDER BY id");
            assert.deepEqual(ids.rows.map((row) => row.id), LOCAL_SCENE_IDS);
        } finally {
            await convertedDb.end();
        }

        const migrated = runServerNode("src/migrate.js", "dump_fresh");
        assert.equal(migrated.status, 0, migrated.stderr);
        const [convertedCatalogDb, freshCatalogDb] = await Promise.all([
            connectDatabase("dump_repaired"),
            connectDatabase("dump_fresh"),
        ]);
        try {
            assert.deepEqual(await catalog(convertedCatalogDb), await catalog(freshCatalogDb));
        } finally {
            await Promise.all([convertedCatalogDb.end(), freshCatalogDb.end()]);
        }
    });
});
