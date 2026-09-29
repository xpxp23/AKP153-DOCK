import sqlite3

conn = sqlite3.connect(r'C:\Users\Administrator\AppData\Roaming\HotSpot\StreamDock\config\DataCache.db')
tables = [x[0] for x in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
print("Tables:", tables)

for t in tables:
    print(f"\n--- Table: {t} ---")
    try:
        rows = conn.execute(f"SELECT * FROM {t}").fetchall()
        for r in rows:
            print(" ", r)
    except Exception as e:
        print("  Error:", e)
