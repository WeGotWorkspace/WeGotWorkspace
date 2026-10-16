<?php

declare(strict_types=1);

namespace App\Services\Auth;

use App\Exceptions\ApiHttpException;
use App\Models\AppSetting;
use App\Models\User;

final class AuthTokenService
{
    public function __construct(
        private JwtConfigService $jwtConfig,
        private JwtTokenService $jwtTokens,
        private RefreshTokenRepository $refreshTokens,
        private RevokedTokenRepository $revokedTokens,
        private LoginRateLimiter $rateLimiter,
        private SabreCredentialValidator $credentials,
        private AdminRoleResolver $adminRoles,
        private UserEnabledGuard $enabled,
    ) {}

    /**
     * @return array{
     *   access_token: string,
     *   refresh_token: string,
     *   token_type: string,
     *   expires_in: int,
     *   refresh_expires_in: int,
     *   role: 'guest'|'user'|'admin',
     *   username: string
     * }
     */
    public function issueFromCredentials(string $username, string $password, string $ip): array
    {
        $username = strtolower(trim($username));
        if ($username === '' || $password === '') {
            throw new ApiHttpException(400, 'Username and password are required.', 'bad_request');
        }
        if (! $this->rateLimiter->allow($username, $ip)) {
            throw new ApiHttpException(429, 'Too many login attempts. Please try again later.', 'throttled');
        }
        if ($this->jwtConfig->signingConfig() === null) {
            throw new ApiHttpException(
                503,
                'JWT key configuration missing. Configure WGW_API_JWT_PRIVATE_KEY(_PATH) and WGW_API_JWT_PUBLIC_KEY(_PATH).',
                'config_error'
            );
        }

        $realm = (string) AppSetting::getValue('auth_realm', (string) config('wgw.auth_realm'));
        if (! $this->credentials->validate($username, $password, $realm)) {
            $this->rateLimiter->hit($username, $ip);
            throw new ApiHttpException(401, 'Invalid credentials.', 'unauthorized');
        }

        $this->rateLimiter->reset($username, $ip);

        return $this->issueForUsername($username);
    }

    /**
     * @return array{
     *   access_token: string,
     *   refresh_token: string,
     *   token_type: string,
     *   expires_in: int,
     *   refresh_expires_in: int,
     *   role: 'guest'|'user'|'admin',
     *   username: string
     * }
     */
    public function refresh(string $refreshToken): array
    {
        if ($refreshToken === '') {
            throw new ApiHttpException(400, 'refresh_token is required.', 'bad_request');
        }
        if ($this->jwtConfig->signingConfig() === null) {
            throw new ApiHttpException(503, 'JWT key configuration missing.', 'config_error');
        }

        $rotated = $this->refreshTokens->consume(
            $refreshToken,
            fn (string $username, string $familyId): string => $this->issueRefreshToken($username, $familyId),
        );
        if ($rotated === null) {
            throw new ApiHttpException(401, 'Invalid refresh token.', 'unauthorized');
        }

        $username = $rotated['username'];
        $this->requireEnabled($username);

        return $this->tokenResponse($username, $this->roleFor($username), $rotated['refresh_token']);
    }

    /**
     * @param  array{username: string, role: 'guest'|'user'|'admin'}  $principal
     */
    public function revoke(?array $principal, ?string $bearerToken, ?string $refreshToken): void
    {
        if ($principal !== null && $bearerToken !== null) {
            $this->revokeAccessToken($bearerToken, $principal);
        }
        if ($refreshToken !== null && $refreshToken !== '') {
            $this->refreshTokens->revoke($refreshToken);
        }
    }

    /**
     * @return array{
     *   access_token: string,
     *   refresh_token: string,
     *   token_type: string,
     *   expires_in: int,
     *   refresh_expires_in: int,
     *   role: 'guest'|'user'|'admin',
     *   username: string
     * }
     */
    public function issueForUsername(string $username): array
    {
        $username = strtolower(trim($username));
        if ($username === '') {
            throw new ApiHttpException(400, 'Username is required.', 'bad_request');
        }
        if ($this->jwtConfig->signingConfig() === null) {
            throw new ApiHttpException(503, 'JWT key configuration missing.', 'config_error');
        }
        if (! $this->enabled->isEnabled($username)) {
            throw new ApiHttpException(401, 'Invalid credentials.', 'unauthorized');
        }

        return $this->issueTokenPair($username, $this->roleFor($username));
    }

    private function issueRefreshToken(string $username, string $familyId): string
    {
        $this->requireEnabled($username);

        return $this->refreshTokens->issue($username, $this->roleFor($username), $familyId);
    }

    private function requireEnabled(string $username): void
    {
        $user = User::query()->where('username', $username)->first();
        if ($user === null || ! $user->isEnabled()) {
            throw new ApiHttpException(401, 'Invalid credentials.', 'unauthorized');
        }
    }

    /**
     * @return 'admin'|'user'
     */
    private function roleFor(string $username): string
    {
        return $this->adminRoles->isAdmin($username) ? 'admin' : 'user';
    }

    /**
     * @param  array{username: string, role: 'guest'|'user'|'admin'}  $principal
     */
    private function revokeAccessToken(string $token, array $principal): void
    {
        $kid = $this->jwtConfig->readKid($token);
        if ($kid === null) {
            return;
        }
        $claims = $this->jwtTokens->validate($token, $kid);
        if ($claims === null || $claims['sub'] !== $principal['username']) {
            return;
        }
        $this->revokedTokens->revoke($claims['jti'], $claims['exp']);
    }

    /**
     * @param  'guest'|'user'|'admin'  $role
     * @return array{
     *   access_token: string,
     *   refresh_token: string,
     *   token_type: string,
     *   expires_in: int,
     *   refresh_expires_in: int,
     *   role: 'guest'|'user'|'admin',
     *   username: string
     * }
     */
    private function issueTokenPair(string $username, string $role): array
    {
        return $this->tokenResponse($username, $role, $this->refreshTokens->issue($username, $role));
    }

    /**
     * @param  'guest'|'user'|'admin'  $role
     * @return array{
     *   access_token: string,
     *   refresh_token: string,
     *   token_type: string,
     *   expires_in: int,
     *   refresh_expires_in: int,
     *   role: 'guest'|'user'|'admin',
     *   username: string
     * }
     */
    private function tokenResponse(string $username, string $role, string $refreshToken): array
    {
        $ttl = $this->jwtConfig->accessTtl();
        $uid = 0;
        if ($role !== 'guest') {
            $user = User::query()->where('username', $username)->first(['id']);
            $uid = $user === null ? 0 : (int) $user->id;
        }
        $access = $this->jwtTokens->issue([
            'sub' => $username,
            'role' => $role,
            'exp' => time() + $ttl,
            'uid' => $uid,
        ]);

        return [
            'access_token' => $access,
            'refresh_token' => $refreshToken,
            'token_type' => 'Bearer',
            'expires_in' => $ttl,
            'refresh_expires_in' => $this->refreshTokens->refreshTtl(),
            'role' => $role,
            'username' => $username,
        ];
    }
}
