<?php

declare(strict_types=1);

namespace App\Services\Auth;

use App\Exceptions\ApiHttpException;

final class AuthTokenService
{
    public function __construct(
        private JwtConfigService $jwtConfig,
        private JwtTokenService $jwtTokens,
        private RefreshTokenRepository $refreshTokens,
        private RevokedTokenRepository $revokedTokens,
        private PasswordLogin $passwordLogin,
        private AdminRoleResolver $adminRoles,
        private UserEnabledGuard $enabled,
    ) {}

    /**
     * Password step. A matching password does not reset the login limiter;
     * that happens only when this method issues tokens.
     *
     * @return array<string, mixed>
     */
    public function issueFromCredentials(string $username, string $password, string $ip): array
    {
        if ($this->jwtConfig->signingConfig() === null) {
            throw new ApiHttpException(
                503,
                'JWT key configuration missing. Configure WGW_API_JWT_PRIVATE_KEY(_PATH) and WGW_API_JWT_PUBLIC_KEY(_PATH).',
                'config_error'
            );
        }

        $result = $this->passwordLogin->accept($username, $password, $ip);
        if ($result['status'] !== 'ok') {
            return $result;
        }

        return ['status' => 'ok'] + $this->issueForUsername((string) $result['username']);
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

        $principal = $this->refreshTokens->consume($refreshToken);
        if ($principal === null) {
            throw new ApiHttpException(401, 'Invalid refresh token.', 'unauthorized');
        }
        $status = $this->enabled->status($principal['username']);
        if (! $status['enabled']) {
            throw new ApiHttpException(401, 'Invalid credentials.', 'unauthorized');
        }

        return $this->issueTokenPair($principal['username'], $principal['role'], $status['generation']);
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
        $status = $this->enabled->status($username);
        if (! $status['enabled']) {
            throw new ApiHttpException(401, 'Invalid credentials.', 'unauthorized');
        }

        $role = $this->adminRoles->isAdmin($username) ? 'admin' : 'user';

        return $this->issueTokenPair($username, $role, $status['generation']);
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
    private function issueTokenPair(string $username, string $role, int $generation): array
    {
        $ttl = $this->jwtConfig->accessTtl();
        $access = $this->jwtTokens->issue([
            'sub' => $username,
            'role' => $role,
            'exp' => time() + $ttl,
            'gen' => $generation,
        ]);
        $refresh = $this->refreshTokens->issue($username, $role, $generation);

        return [
            'access_token' => $access,
            'refresh_token' => $refresh,
            'token_type' => 'Bearer',
            'expires_in' => $ttl,
            'refresh_expires_in' => $this->refreshTokens->refreshTtl(),
            'role' => $role,
            'username' => $username,
        ];
    }
}
