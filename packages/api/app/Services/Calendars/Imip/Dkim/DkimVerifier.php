<?php

declare(strict_types=1);

namespace App\Services\Calendars\Imip\Dkim;

/**
 * Verifies the DKIM signatures of one whole message (RFC 6376, RFC 8301,
 * RFC 8463): `rsa-sha256` and `ed25519-sha256`, simple and relaxed
 * canonicalization. Only signatures whose `d=` the caller accepts are
 * checked, so a signature that could not count is never looked up in DNS.
 * The first passing signature decides.
 *
 * Stricter than the RFC on purpose: `l=` must cover the whole body, RSA
 * keys are 1024 to 4096 bits, a key in testing mode counts as unsigned,
 * and a selector with more than one key record fails.
 */
class DkimVerifier
{
    /** Signature fields looked at per message, top first. */
    public const MAX_SIGNATURES = 5;

    private const MIN_RSA_BITS = 1024;

    private const MAX_RSA_BITS = 4096;

    public function __construct(private readonly DkimKeyStore $keys) {}

    /**
     * @param  callable(string): bool  $acceptDomain  whether a signature by this `d=` could count
     */
    public function verify(string $message, callable $acceptDomain, int $now): DkimResult
    {
        $parsed = DkimMessage::parse($message);
        if ($parsed === null) {
            return DkimResult::fail(DkimResult::MALFORMED);
        }
        $failure = null;
        $temporary = false;
        $looked = 0;
        foreach ($parsed->fields as $field) {
            if ($field['name'] !== 'dkim-signature') {
                continue;
            }
            if (++$looked > self::MAX_SIGNATURES) {
                break;
            }
            $signature = DkimSignature::parse($field['raw']);
            if ($signature === null) {
                $failure ??= DkimResult::MALFORMED;

                continue;
            }
            if (! $acceptDomain($signature->domain)) {
                continue;
            }
            $result = $this->verifyOne($parsed, $field['raw'], $signature, $now);
            if ($result->passed()) {
                return $result;
            }
            if ($result->status === DkimResult::TEMPERROR) {
                $temporary = true;
            } else {
                $failure ??= $result->reason;
            }
        }
        if ($temporary) {
            return DkimResult::temperror();
        }

        return $failure !== null ? DkimResult::fail($failure) : DkimResult::none();
    }

    private function verifyOne(DkimMessage $message, string $rawField, DkimSignature $signature, int $now): DkimResult
    {
        if ($signature->algorithm !== DkimSignature::RSA_SHA256 && $signature->algorithm !== DkimSignature::ED25519_SHA256) {
            return DkimResult::fail(DkimResult::ALGORITHM);
        }
        if ($signature->expires !== null && $signature->expires < $now) {
            return DkimResult::fail(DkimResult::EXPIRED);
        }
        $body = DkimCanonicalizer::body($message->body, $signature->bodyCanonicalization);
        if ($signature->bodyLength !== null && $signature->bodyLength !== strlen($body)) {
            return DkimResult::fail(DkimResult::PARTIAL_BODY);
        }
        if (! hash_equals($signature->bodyHash, hash('sha256', $body, true))) {
            return DkimResult::fail(DkimResult::BODY_HASH);
        }

        $key = $this->key($signature);
        if (is_string($key)) {
            return $key === DkimResult::DNS_UNAVAILABLE ? DkimResult::temperror() : DkimResult::fail($key);
        }
        $refusal = $key->refusal($signature);
        if ($refusal !== '') {
            return DkimResult::fail($refusal);
        }

        [$data, $date] = $this->signedHeaderData($message, $rawField, $signature);
        $verified = $signature->algorithm === DkimSignature::ED25519_SHA256
            ? $this->verifyEd25519($data, $signature->signature, $key->publicKey)
            : $this->verifyRsa($data, $signature->signature, $key->publicKey);
        if (is_string($verified)) {
            return DkimResult::fail($verified);
        }
        if (! $verified) {
            return DkimResult::fail(DkimResult::SIGNATURE);
        }

        return DkimResult::pass(
            $signature->domain,
            $signature->timestamp ?? self::dateTime($date),
            hash('sha256', $signature->signature),
        );
    }

    /** The one key record for the selector, or a reason code. */
    private function key(DkimSignature $signature): DkimKey|string
    {
        $answer = $this->keys->lookup($signature->selector, $signature->domain);
        if ($answer === null) {
            return DkimResult::MALFORMED;
        }
        if ($answer->status === DnsTxtAnswer::ERROR) {
            return DkimResult::DNS_UNAVAILABLE;
        }
        $keys = array_values(array_filter(array_map(DkimKey::parse(...), $answer->records)));
        if ($keys === []) {
            return DkimResult::KEY_MISSING;
        }

        return count($keys) === 1 ? $keys[0] : DkimResult::KEY_INVALID;
    }

    /**
     * The header hash input (RFC 6376 3.7) and the signed `Date:` value.
     * Each name in `h=` takes the bottom-most instance not used yet; a name
     * with no instance left adds nothing.
     *
     * @return array{0: string, 1: ?string}
     */
    private function signedHeaderData(DkimMessage $message, string $rawField, DkimSignature $signature): array
    {
        $instances = [];
        foreach ($message->fields as $index => $field) {
            $instances[$field['name']][] = $index;
        }
        $data = '';
        $date = null;
        foreach ($signature->signedHeaders as $name) {
            if (($instances[$name] ?? []) === []) {
                continue;
            }
            $raw = $message->fields[array_pop($instances[$name])]['raw'];
            if ($name === 'date') {
                $date ??= DkimMessage::value($raw);
            }
            $data .= DkimCanonicalizer::header($raw, $signature->headerCanonicalization);
        }
        $own = DkimCanonicalizer::header(DkimSignature::withoutSignatureValue($rawField), $signature->headerCanonicalization);

        return [$data.(str_ends_with($own, "\r\n") ? substr($own, 0, -2) : $own), $date];
    }

    private function verifyRsa(string $data, string $signature, string $publicKey): bool|string
    {
        $der = base64_decode($publicKey, true);
        if ($der === false || $der === '') {
            return DkimResult::KEY_INVALID;
        }
        $body = chunk_split(base64_encode($der), 64, "\n");
        $key = @openssl_pkey_get_public("-----BEGIN PUBLIC KEY-----\n{$body}-----END PUBLIC KEY-----\n");
        if ($key === false) {
            $key = @openssl_pkey_get_public("-----BEGIN RSA PUBLIC KEY-----\n{$body}-----END RSA PUBLIC KEY-----\n");
        }
        $details = $key !== false ? openssl_pkey_get_details($key) : false;
        self::clearOpenSslErrors();
        if ($key === false || $details === false || ($details['type'] ?? null) !== OPENSSL_KEYTYPE_RSA) {
            return DkimResult::KEY_INVALID;
        }
        $bits = (int) ($details['bits'] ?? 0);
        if ($bits < self::MIN_RSA_BITS || $bits > self::MAX_RSA_BITS) {
            return DkimResult::KEY_INVALID;
        }
        $ok = openssl_verify($data, $signature, $key, OPENSSL_ALGO_SHA256);
        self::clearOpenSslErrors();

        return $ok === 1;
    }

    /** OpenSSL keeps failed parses in a queue; empty it so it does not leak into later calls. */
    private static function clearOpenSslErrors(): void
    {
        while (openssl_error_string() !== false) {
            // Drain.
        }
    }

    /** RFC 8463 3: Ed25519 over the SHA-256 hash of the header data. */
    private function verifyEd25519(string $data, string $signature, string $publicKey): bool|string
    {
        $key = base64_decode($publicKey, true);
        if ($key === false || strlen($key) !== SODIUM_CRYPTO_SIGN_PUBLICKEYBYTES) {
            return DkimResult::KEY_INVALID;
        }
        if (strlen($signature) !== SODIUM_CRYPTO_SIGN_BYTES) {
            return false;
        }
        try {
            return sodium_crypto_sign_verify_detached($signature, hash('sha256', $data, true), $key);
        } catch (\SodiumException) {
            return false;
        }
    }

    private static function dateTime(?string $value): ?int
    {
        if ($value === null) {
            return null;
        }
        $clean = trim((string) preg_replace('/\([^()]*\)/', ' ', $value));
        $time = strtotime($clean);

        return $time === false ? null : $time;
    }
}
