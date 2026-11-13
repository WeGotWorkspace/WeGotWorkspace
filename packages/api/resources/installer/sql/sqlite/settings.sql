CREATE TABLE IF NOT EXISTS app_settings (
    name TEXT NOT NULL PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meet_peers (
    room TEXT NOT NULL,
    peer_id TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    seen_at INTEGER NOT NULL,
    PRIMARY KEY(room, peer_id)
);

CREATE TABLE IF NOT EXISTS meet_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room TEXT NOT NULL,
    from_peer TEXT NOT NULL,
    to_peer TEXT NOT NULL,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_meet_msg_target ON meet_messages(room, to_peer, id);
CREATE INDEX IF NOT EXISTS idx_meet_peers_room ON meet_peers(room);

CREATE TABLE IF NOT EXISTS collab_peers (
    room TEXT NOT NULL,
    peer_id TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    owner_user TEXT NOT NULL DEFAULT '',
    seen_at INTEGER NOT NULL,
    PRIMARY KEY(room, peer_id)
);

CREATE TABLE IF NOT EXISTS collab_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room TEXT NOT NULL,
    from_peer TEXT NOT NULL,
    to_peer TEXT NOT NULL,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_collab_msg_target ON collab_messages(room, to_peer, id);
CREATE INDEX IF NOT EXISTS idx_collab_peers_room ON collab_peers(room);
