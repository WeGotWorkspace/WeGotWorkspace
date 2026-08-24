<?php

declare(strict_types=1);

namespace App\Services\Calendars;

use App\Exceptions\ApiHttpException;
use App\Services\VObject\VObjectPayloadGuard;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;

/**
 * Fetches a remote ICS / webcal URL after SSRF checks (scheme, resolved IPs,
 * redirect re-validation) and the existing {@see VObjectPayloadGuard} size cap.
 */
final class SsrfSafeIcsFetcher
{
    public const MAX_REDIRECTS = 5;

    private const TIMEOUT_SECONDS = 15;

    private const CONNECT_TIMEOUT_SECONDS = 5;

    public function __construct(
        private readonly HostIpResolver $resolver,
        private readonly VObjectPayloadGuard $payloadGuard,
    ) {}

    public function normalizeUrl(string $url): string
    {
        $url = trim($url);
        if ($url === '') {
            throw new ApiHttpException(400, 'url is required.', 'bad_request');
        }

        if (preg_match('#^webcals?://#i', $url) === 1) {
            $url = 'https://'.substr($url, (int) strpos($url, '://') + 3);
        }

        return $url;
    }

    public function fetch(string $url): string
    {
        $current = $this->normalizeUrl($url);
        $this->assertSafeUrl($current);

        for ($hop = 0; $hop <= self::MAX_REDIRECTS; $hop++) {
            $response = $this->request($current);

            if ($response->redirect()) {
                $location = trim((string) $response->header('Location'));
                if ($location === '') {
                    throw new ApiHttpException(400, 'The calendar feed redirected without a Location header.', 'bad_request');
                }
                $current = $this->absoluteUrl($current, $location);
                $this->assertSafeUrl($current);

                continue;
            }

            if (! $response->successful()) {
                throw new ApiHttpException(400, 'Could not fetch the calendar feed.', 'bad_request');
            }

            $length = $response->header('Content-Length');
            if (is_numeric($length) && (int) $length > VObjectPayloadGuard::MAX_ICS_BYTES) {
                throw new ApiHttpException(
                    413,
                    'iCalendar payload exceeds the maximum allowed size of '.VObjectPayloadGuard::MAX_ICS_BYTES.' bytes.',
                    'payload_too_large',
                );
            }

            $body = $response->body();
            $this->payloadGuard->assertIcsSize($body);

            return $body;
        }

        throw new ApiHttpException(400, 'The calendar feed redirected too many times.', 'bad_request');
    }

    public function assertSafeUrl(string $url): void
    {
        $parts = parse_url($url);
        if (! is_array($parts)) {
            throw new ApiHttpException(400, 'url is not a valid calendar feed URL.', 'bad_request');
        }

        $scheme = strtolower((string) ($parts['scheme'] ?? ''));
        if (! in_array($scheme, ['http', 'https'], true)) {
            throw new ApiHttpException(400, 'Only http and https calendar feed URLs are accepted.', 'bad_request');
        }

        $host = $this->resolver->normalizeHost((string) ($parts['host'] ?? ''));
        if ($host === '') {
            throw new ApiHttpException(400, 'url is not a valid calendar feed URL.', 'bad_request');
        }

        $ips = $this->resolver->resolve($host);
        if ($ips === []) {
            throw new ApiHttpException(400, 'Could not resolve the calendar feed host.', 'bad_request');
        }

        foreach ($ips as $ip) {
            $this->assertPublicIp($ip);
        }
    }

    /**
     * @return Response
     */
    private function request(string $url)
    {
        $parts = parse_url($url);
        $host = $this->resolver->normalizeHost((string) ($parts['host'] ?? ''));
        $scheme = strtolower((string) ($parts['scheme'] ?? 'https'));
        $port = isset($parts['port']) ? (int) $parts['port'] : ($scheme === 'http' ? 80 : 443);
        $ips = $this->resolver->resolve($host);
        $connectIp = $ips[0] ?? $host;

        try {
            return Http::withOptions([
                'allow_redirects' => false,
                'timeout' => self::TIMEOUT_SECONDS,
                'connect_timeout' => self::CONNECT_TIMEOUT_SECONDS,
                'curl' => [
                    CURLOPT_RESOLVE => [$host.':'.$port.':'.$connectIp],
                ],
            ])->withHeaders([
                'Accept' => 'text/calendar, text/plain, */*',
            ])->get($url);
        } catch (ConnectionException) {
            throw new ApiHttpException(400, 'Could not fetch the calendar feed.', 'bad_request');
        } catch (ApiHttpException $exception) {
            throw $exception;
        } catch (\Throwable) {
            throw new ApiHttpException(400, 'Could not fetch the calendar feed.', 'bad_request');
        }
    }

    private function absoluteUrl(string $current, string $location): string
    {
        if (preg_match('#^webcals?://#i', $location) === 1) {
            $location = 'https://'.substr($location, (int) strpos($location, '://') + 3);
        }
        if (preg_match('#^[a-z][a-z0-9+.-]*:#i', $location) === 1) {
            return $location;
        }

        $base = parse_url($current);
        if (! is_array($base) || ! isset($base['scheme'], $base['host'])) {
            throw new ApiHttpException(400, 'The calendar feed redirected to an invalid URL.', 'bad_request');
        }

        $origin = $base['scheme'].'://'.$base['host'];
        if (isset($base['port'])) {
            $origin .= ':'.$base['port'];
        }

        if (str_starts_with($location, '//')) {
            return $base['scheme'].':'.$location;
        }
        if (str_starts_with($location, '/')) {
            return $origin.$location;
        }

        $path = (string) ($base['path'] ?? '/');
        $dir = str_contains($path, '/') ? substr($path, 0, (int) strrpos($path, '/') + 1) : '/';

        return $origin.$dir.$location;
    }

    private function assertPublicIp(string $ip): void
    {
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) === false) {
            throw new ApiHttpException(400, 'This URL is not allowed.', 'bad_request');
        }
    }
}
