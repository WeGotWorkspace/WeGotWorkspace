<?php

declare(strict_types=1);

namespace App\Services\Auth;

final class JwtTokenService
{
    public function __construct(private JwtConfigService $jwtConfig) {}

    /**
     * @param  array{sub: string, role: 'guest'|'user'|'admin', exp?: int, iat?: int}  $claims
     */
    public function issue(array $claims): string
    {
        $cfg = $this->requireSigningConfig();

        $exp = $claims['exp'] ?? null;
        if (! is_int($exp)) {
            throw new \InvalidArgumentException('JWT exp claim is required.');
        }
        $issued = [
            'sub' => $claims['sub'],
            'role' => $claims['role'],
            'exp' => $exp,
        ];
        if (isset($claims['iat'])) {
            $issued['iat'] = $claims['iat'];
        }

        return JwtCodec::issue($issued, $cfg);
    }

    /**
     * @return array{sub: string, role: 'guest'|'user'|'admin', iat: int, exp: int, iss: string, aud: string, jti: string}|null
     */
    public function validate(string $token, string $kid): ?array
    {
        $cfg = $this->jwtConfig->verificationConfigForKid($kid);
        if ($cfg === null) {
            return null;
        }

        return JwtCodec::validate($token, $cfg);
    }

    /**
     * @return array{
     *   privateKey: string,
     *   publicKey: string,
     *   issuer: string,
     *   audience: string,
     *   kid: string
     * }
     */
    private function requireSigningConfig(): array
    {
        $cfg = $this->jwtConfig->signingConfig();
        if ($cfg === null) {
            throw new \RuntimeException(
                'JWT key configuration missing. Configure WGW_API_JWT_PRIVATE_KEY(_PATH) and WGW_API_JWT_PUBLIC_KEY(_PATH).'
            );
        }

        return $cfg;
    }
}
