<?php

declare(strict_types=1);

namespace App\Services\Auth;

use Lcobucci\JWT\Configuration;
use Lcobucci\JWT\Signer\Key\InMemory;
use Lcobucci\JWT\Signer\Rsa\Sha256;
use Lcobucci\JWT\Token;
use Lcobucci\JWT\Validation\Constraint\IssuedBy;
use Lcobucci\JWT\Validation\Constraint\LooseValidAt;
use Lcobucci\JWT\Validation\Constraint\PermittedFor;
use Lcobucci\JWT\Validation\Constraint\SignedWith;
use Psr\Clock\ClockInterface;

final class JwtCodec
{
    /**
     * @param  array{sub: string, role: 'guest'|'user'|'admin', exp: int, iat?: int}  $claims
     * @param array{
     *   privateKey: string,
     *   publicKey: string,
     *   issuer: string,
     *   audience: string,
     *   kid: string
     * } $cfg
     */
    public static function issue(array $claims, array $cfg): string
    {
        $now = time();
        $iat = (int) ($claims['iat'] ?? $now);
        $exp = (int) $claims['exp'];
        $sub = (string) $claims['sub'];
        $role = (string) $claims['role'];
        $issuedAt = (new \DateTimeImmutable)->setTimestamp($iat);
        $expiresAt = (new \DateTimeImmutable)->setTimestamp($exp);

        $config = self::configuration($cfg);
        $token = $config->builder()
            ->withHeader('kid', $cfg['kid'])
            ->issuedBy($cfg['issuer'])
            ->permittedFor($cfg['audience'])
            ->issuedAt($issuedAt)
            ->canOnlyBeUsedAfter($issuedAt)
            ->expiresAt($expiresAt)
            ->relatedTo($sub)
            ->identifiedBy(bin2hex(random_bytes(16)))
            ->withClaim('role', $role)
            ->getToken($config->signer(), $config->signingKey());

        return $token->toString();
    }

    /**
     * @param array{
     *   privateKey: string,
     *   publicKey: string,
     *   issuer: string,
     *   audience: string,
     *   kid: string
     * } $cfg
     * @return array{sub: string, role: 'guest'|'user'|'admin', iat: int, exp: int, iss: string, aud: string, jti: string}|null
     */
    public static function validate(string $token, array $cfg): ?array
    {
        try {
            $config = self::configuration($cfg);
            $parsed = $config->parser()->parse($token);
            if (! $parsed instanceof Token\Plain) {
                return null;
            }
            if (! $parsed->headers()->has('kid') || $parsed->headers()->get('kid') !== $cfg['kid']) {
                return null;
            }
            $constraints = [
                new SignedWith($config->signer(), $config->verificationKey()),
                new LooseValidAt(self::clock()),
                new IssuedBy($cfg['issuer']),
                new PermittedFor($cfg['audience']),
            ];
            if (! $config->validator()->validate($parsed, ...$constraints)) {
                return null;
            }
        } catch (\Throwable) {
            return null;
        }
        $sub = trim($parsed->claims()->get('sub', ''));
        $role = (string) $parsed->claims()->get('role', '');
        $iatClaim = $parsed->claims()->get('iat', null);
        $expClaim = $parsed->claims()->get('exp', null);
        $iss = (string) $parsed->claims()->get('iss', '');
        $jti = (string) $parsed->claims()->get('jti', '');
        $audClaim = $parsed->claims()->get('aud', []);
        $aud = '';
        if (is_string($audClaim)) {
            $aud = $audClaim;
        }
        if (is_array($audClaim) && isset($audClaim[0]) && is_string($audClaim[0])) {
            $aud = $audClaim[0];
        }
        $iat = $iatClaim instanceof \DateTimeImmutable ? $iatClaim->getTimestamp() : 0;
        $exp = $expClaim instanceof \DateTimeImmutable ? $expClaim->getTimestamp() : 0;

        if ($sub === '' || ! in_array($role, ['guest', 'user', 'admin'], true) || $iat <= 0 || $exp <= 0 || $jti === '') {
            return null;
        }
        if ($iss !== $cfg['issuer']) {
            return null;
        }
        if ($aud !== $cfg['audience']) {
            return null;
        }

        return [
            'sub' => $sub,
            'role' => $role,
            'iat' => $iat,
            'exp' => $exp,
            'iss' => $iss,
            'aud' => $aud,
            'jti' => $jti,
        ];
    }

    /**
     * @param array{
     *   privateKey: string,
     *   publicKey: string,
     *   issuer: string,
     *   audience: string,
     *   kid: string
     * } $cfg
     */
    private static function configuration(array $cfg): Configuration
    {
        return Configuration::forAsymmetricSigner(
            new Sha256,
            InMemory::plainText($cfg['privateKey']),
            InMemory::plainText($cfg['publicKey'])
        );
    }

    private static function clock(): ClockInterface
    {
        return new class implements ClockInterface
        {
            public function now(): \DateTimeImmutable
            {
                return new \DateTimeImmutable('now', new \DateTimeZone('UTC'));
            }
        };
    }
}
