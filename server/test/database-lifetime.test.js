import assert from "node:assert/strict";
import { test } from "node:test";
import { createTestDatabases } from "./helpers/database-lifetime.js";

function memoryAdmin(existing = []) {
    const names = new Set(existing);
    const failedDrops = new Set();
    const admin = async (work) => work(async (sql) => {
        const create = sql.match(/^CREATE DATABASE (\w+)$/);
        if (create) {
            if (names.has(create[1])) throw new Error("database already exists");
            names.add(create[1]);
        } else {
            const name = sql.match(/^DROP DATABASE IF EXISTS (\w+) WITH \(FORCE\)$/)?.[1];
            assert.ok(name, sql);
            if (failedDrops.has(name)) throw new Error("drop failed");
            names.delete(name);
        }
    });
    return { names, failedDrops, admin };
}

test("partial setup cleans acquired databases and leaves pre-existing and unattempted names alone", async () => {
    const memory = memoryAdmin(["scriptdeck_test_existing", "scriptdeck_test_unattempted"]);
    const databases = createTestDatabases(memory.admin);
    await databases.create("scriptdeck_test_created");
    await assert.rejects(databases.create("scriptdeck_test_existing"), /already exists/);
    await databases.cleanup();
    assert.deepEqual([...memory.names].sort(), ["scriptdeck_test_existing", "scriptdeck_test_unattempted"]);
});

test("a borrowed database survives an empty lifetime", async () => {
    const memory = memoryAdmin(["scriptdeck_test_supplied"]);
    const databases = createTestDatabases(memory.admin);
    await databases.cleanup();
    assert.deepEqual([...memory.names], ["scriptdeck_test_supplied"]);
});

test("cleanup attempts every owned database even when a drop fails", async () => {
    const memory = memoryAdmin();
    const databases = createTestDatabases(memory.admin);
    for (const name of ["first", "second", "third"]) await databases.create(`scriptdeck_test_${name}`);
    memory.failedDrops.add("scriptdeck_test_second");
    await assert.rejects(databases.cleanup(), (error) => {
        assert.ok(error instanceof AggregateError);
        assert.match(error.errors[0].message, /scriptdeck_test_second/);
        return true;
    });
    assert.deepEqual([...memory.names], ["scriptdeck_test_second"]);
});

test("ownership survives a failed connection close after successful creation", async () => {
    const memory = memoryAdmin();
    let failClose = true;
    const databases = createTestDatabases(async (work) => {
        await memory.admin(work);
        if (failClose) throw new Error("connection close failed");
    });
    await assert.rejects(databases.create("scriptdeck_test_created"), /close failed/);
    failClose = false;
    await databases.cleanup();
    assert.equal(memory.names.size, 0);
});

test("cleanup waits for acquisition and refuses later creates", async () => {
    const memory = memoryAdmin();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const databases = createTestDatabases(async (work) => {
        await gate;
        return memory.admin(work);
    });
    const creation = databases.create("scriptdeck_test_pending");
    const cleanup = databases.cleanup();
    await assert.rejects(databases.create("scriptdeck_test_late"), /cleanup has already started/);
    release();
    await creation;
    await cleanup;
    assert.equal(memory.names.size, 0);
});

test("repeated cleanup cannot delete a database later acquired by another run", async () => {
    const memory = memoryAdmin();
    const databases = createTestDatabases(memory.admin);
    await databases.create("scriptdeck_test_reused");
    await databases.cleanup();
    memory.names.add("scriptdeck_test_reused");
    await databases.cleanup();
    assert.ok(memory.names.has("scriptdeck_test_reused"));
});

test("unsafe and truncated names are refused before contacting PostgreSQL", async () => {
    let contacted = false;
    const databases = createTestDatabases(async () => { contacted = true; });
    for (const name of ["scriptdeck", "scriptdeck_test_x;DROP", `scriptdeck_test_${"x".repeat(51)}`]) {
        await assert.rejects(databases.create(name), /unsafe test database name/);
    }
    assert.equal(contacted, false);
});
