<?php

declare(strict_types=1);

namespace App\Services\Auth;

final class BearerAuthenticationService
{
    public function __construct(
        private JwtConfigService $jwtConfig,
        private JwtTokenService $jwtTokens,
        private RevokedTokenRepository $revokedTokens,
        private UserEnabledGuard $enabled,
    ) {}

    /**
     * @return array{username: string, role: 'guest'|'user'|'admin'}|null
     */
    public function authenticate(?string $authorizationHeader): ?array
    {
        if ($authorizationHeader === null || ! preg_match('/^Bearer\s+(.+)$/i', $authorizationHeader, $matches)) {
            return null;
        }
        $token = trim((string) $matches[1]);
        if ($token === '') {
            return null;
        }
        $kid = $this->jwtConfig->readKid($token);
        if ($kid === null) {
            return null;
        }
        $claims = $this->jwtTokens->validate($token, $kid);
        if ($claims === null) {
            return null;
        }
        if ($this->revokedTokens->isRevoked($claims['jti'])) {
            return null;
        }
        // Guest subjects (share links, Meet peers) have no users row. The guard
        // treats that as disabled; role checks still reject them on user routes.
        if ($claims['role'] !== 'guest' && ! $this->enabled->isEnabled($claims['sub'])) {
            return null;
        }

        return [
            'username' => $claims['sub'],
            'role' => $claims['role'],
        ];
    }

    public function extractBearerToken(?string $authorizationHeader): ?string
    {
        if ($authorizationHeader === null || ! preg_match('/^Bearer\s+(.+)$/i', $authorizationHeader, $matches)) {
            return null;
        }
        $token = trim((string) $matches[1]);

        return $token !== '' ? $token : null;
    }
}
