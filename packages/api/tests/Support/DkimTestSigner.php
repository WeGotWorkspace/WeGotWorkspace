<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Services\Calendars\Imip\Dkim\DkimCanonicalizer;

/**
 * Signs test messages with DKIM so the verifier's rules can be tested one by
 * one (expiry, weak keys, `l=`, key flags). Keys are made per test run and
 * never stored. Interoperability is proven separately by fixtures signed
 * with dkimpy and by RFC 8463's example.
 */
final class DkimTestSigner
{
    /** @var array<int, \OpenSSLAsymmetricKey> */
    private static array $rsaKeys = [];

    private static ?string $ed25519Secret = null;

    public static function rsaKey(int $bits = 1024): \OpenSSLAsymmetricKey
    {
        if (! isset(self::$rsaKeys[$bits])) {
            $key = openssl_pkey_new(['private_key_bits' => $bits, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
            if ($key === false) {
                throw new \RuntimeException('Could not make an RSA test key.');
            }
            self::$rsaKeys[$bits] = $key;
        }

        return self::$rsaKeys[$bits];
    }

    /** The `p=` value for an RSA test key (SubjectPublicKeyInfo, base64). */
    public static function rsaPublic(int $bits = 1024): string
    {
        $details = openssl_pkey_get_details(self::rsaKey($bits));
        $pem = is_array($details) ? (string) $details['key'] : '';

        return (string) preg_replace('/-----[^-]+-----|\s+/', '', $pem);
    }

    public static function ed25519Public(): string
    {
        return base64_encode(sodium_crypto_sign_publickey(self::ed25519Pair()));
    }

    /**
     * Prepends a DKIM-Signature field to `$message` (CRLF line ends).
     *
     * @param  array<string, string>  $tags  extra or replacing tags, for example `x`, `l`, `t`, `i`, `c`, `a`
     * @param  list<string>  $headers  the `h=` list
     */
    public static function sign(
        string $message,
        string $domain,
        string $selector,
        array $tags = [],
        array $headers = ['from', 'to', 'subject', 'date'],
        int $rsaBits = 1024,
    ): string {
        $algorithm = $tags['a'] ?? 'rsa-sha256';
        [$headerMode, $bodyMode] = explode('/', ($tags['c'] ?? 'relaxed/relaxed').'/simple');
        [$head, $body] = explode("\r\n\r\n", $message, 2) + [1 => ''];
        $canonicalBody = DkimCanonicalizer::body($body, $bodyMode);
        if (isset($tags['l']) && ctype_digit($tags['l'])) {
            $canonicalBody = substr($canonicalBody, 0, (int) $tags['l']);
        }
        $all = array_merge([
            'v' => '1',
            'a' => $algorithm,
            'c' => $headerMode.'/'.$bodyMode,
            'd' => $domain,
            's' => $selector,
            't' => (string) time(),
        ], $tags, [
            'h' => implode(':', $headers),
            'bh' => base64_encode(hash('sha256', $canonicalBody, true)),
        ]);
        $all = array_filter($all, static fn (string $value): bool => $value !== '');
        $field = 'DKIM-Signature: '.implode('; ', array_map(
            static fn (string $name, string $value): string => $name.'='.$value,
            array_keys($all),
            $all,
        )).'; b=';

        $data = '';
        $fields = self::fields($head);
        foreach ($headers as $name) {
            for ($i = count($fields) - 1; $i >= 0; $i--) {
                if ($fields[$i] !== null && strtolower(strstr($fields[$i], ':', true) ?: '') === $name) {
                    $data .= DkimCanonicalizer::header($fields[$i]."\r\n", $headerMode);
                    $fields[$i] = null;
                    break;
                }
            }
        }
        $data .= rtrim(DkimCanonicalizer::header($field."\r\n", $headerMode), "\r\n");

        return $field.rtrim(chunk_split(base64_encode(self::signData($algorithm, $data, $rsaBits)), 64, "\r\n "), "\r\n ")
            ."\r\n".$message;
    }

    private static function signData(string $algorithm, string $data, int $rsaBits): string
    {
        if ($algorithm === 'ed25519-sha256') {
            return sodium_crypto_sign_detached(hash('sha256', $data, true), sodium_crypto_sign_secretkey(self::ed25519Pair()));
        }
        $signature = '';
        openssl_sign($data, $signature, self::rsaKey($rsaBits), $algorithm === 'rsa-sha1' ? OPENSSL_ALGO_SHA1 : OPENSSL_ALGO_SHA256);

        return $signature;
    }

    /** @return list<string|null> raw fields without their final CRLF */
    private static function fields(string $head): array
    {
        $fields = [];
        foreach (explode("\r\n", $head) as $line) {
            if ($fields !== [] && ($line[0] ?? '') === ' ') {
                $fields[count($fields) - 1] .= "\r\n".$line;
            } else {
                $fields[] = $line;
            }
        }

        return $fields;
    }

    private static function ed25519Pair(): string
    {
        return self::$ed25519Secret ??= sodium_crypto_sign_keypair();
    }
}
