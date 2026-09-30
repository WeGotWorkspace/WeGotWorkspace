<?php

namespace Laravel\Passport;

/**
 * oauth_clients is created with $this->wgw(), which Larastan does not read.
 * Casts live on the vendor model; columns are declared here.
 *
 * @property string $id
 * @property string|null $owner_type
 * @property int|null $owner_id
 * @property string $name
 * @property string|null $secret
 * @property string|null $provider
 * @property list<string> $redirect_uris
 * @property array<string, mixed> $grant_types
 * @property array<string, mixed>|null $scopes
 * @property bool $revoked
 * @property string|null $cimd_url
 * @property string|null $cimd_origin
 */
class Client {}
