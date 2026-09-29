<?php

declare(strict_types=1);

namespace App\Services\Auth;

use App\Dav\Auth\UiAuthSecret;
use App\Services\Installer\InstallerWebBase;
use App\Support\WgwInstallConfig;
use Symfony\Component\HttpFoundation\Cookie;

/**
 * Signed HttpOnly browser session cookie for plugin UI shells and drive HTML.
 */
final class UiSessionService
{
    private const COOKIE = 'sabre_ui_auth';

    private const COOKIE_VERSION = 1;

    private const TTL_SEC = 2592000;

    public function __construct(private WgwInstallConfig $install) {}

    public function establish(string $username, string $realm, string $webBase): Cookie
    {
        $this->ensureSecretFile();

        $normalized = strtolower(trim($username));
        if ($normalized === '') {
            throw new \InvalidArgumentException('Username is required.');
        }

        return $this->buildCookie($normalized, $realm, $this->cookiePath($webBase));
    }

    private function ensureSecretFile(): void
    {
        UiAuthSecret::ensure($this->install);
    }

    /**
     * @param  non-empty-string  $username
     */
    public function buildCookie(string $username, string $realm, string $path): Cookie
    {
        $secret = UiAuthSecret::read();
        if ($secret === null) {
            throw new \RuntimeException('UI auth secret is not available.');
        }

        $exp = time() + self::TTL_SEC;
        $payload = json_encode([
            'v' => self::COOKIE_VERSION,
            'u' => $username,
            'r' => $realm,
            'e' => $exp,
            'exp' => $exp,
        ], JSON_THROW_ON_ERROR);

        $b64Payload = $this->base64UrlEncode($payload);
        $sig = hash_hmac('sha256', $b64Payload, $secret, true);
        $value = $b64Payload.'.'.$this->base64UrlEncode($sig);

        $secure = (! empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
            || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https');

        return Cookie::create(
            self::COOKIE,
            $value,
            time() + self::TTL_SEC,
            $path === '' ? '/' : $path,
            null,
            $secure,
            true,
            false,
            Cookie::SAMESITE_LAX,
        );
    }

    private function cookiePath(string $webBase): string
    {
        $path = rtrim(InstallerWebBase::url($webBase, '/'), '/');

        return $path === '' ? '/' : $path;
    }

    private function base64UrlEncode(string $data): string
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }
}
