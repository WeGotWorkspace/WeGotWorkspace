CREATE TABLE IF NOT EXISTS app_settings (
    name VARCHAR(191) NOT NULL PRIMARY KEY,
    value TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS meet_peers (
    room VARCHAR(64) NOT NULL,
    peer_id VARCHAR(64) NOT NULL,
    name VARCHAR(64) NOT NULL DEFAULT '',
    seen_at BIGINT NOT NULL,
    PRIMARY KEY(room, peer_id),
    KEY idx_meet_peers_room (room)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS meet_messages (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    room VARCHAR(64) NOT NULL,
    from_peer VARCHAR(64) NOT NULL,
    to_peer VARCHAR(64) NOT NULL,
    type VARCHAR(16) NOT NULL,
    payload MEDIUMTEXT NOT NULL,
    created_at BIGINT NOT NULL,
    PRIMARY KEY(id),
    KEY idx_meet_msg_target (room, to_peer, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS collab_peers (
    room VARCHAR(190) NOT NULL,
    peer_id VARCHAR(16) NOT NULL,
    name VARCHAR(64) NOT NULL DEFAULT '',
    owner_user VARCHAR(190) NOT NULL DEFAULT '',
    seen_at BIGINT NOT NULL,
    PRIMARY KEY(room, peer_id),
    KEY idx_collab_peers_room (room)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS collab_messages (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    room VARCHAR(190) NOT NULL,
    from_peer VARCHAR(16) NOT NULL,
    to_peer VARCHAR(16) NOT NULL,
    type VARCHAR(16) NOT NULL,
    payload MEDIUMTEXT NOT NULL,
    created_at BIGINT NOT NULL,
    PRIMARY KEY(id),
    KEY idx_collab_msg_target (room, to_peer, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
