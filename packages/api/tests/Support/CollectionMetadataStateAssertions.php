<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Dav\SabreServerFactory;
use App\Models\Principal;
use App\Services\Admin\AdminConstants;
use Sabre\DAV\Exception as SabreDavException;
use Sabre\HTTP\Request as SabreRequest;
use Sabre\HTTP\Response as SabreResponse;

/**
 * Shared helpers for the collection rename / recolour state tests (#1671):
 * a DAV request straight into the Sabre server, PROPPATCH bodies, and the
 * assertion that a `/changes` answer reports one collection as updated.
 */
trait CollectionMetadataStateAssertions
{
    protected const APPLE_CALENDAR_COLOR = '{http://apple.com/ns/ical/}calendar-color';

    /** The Sabre server needs a data directory and the groups principal container. */
    protected function setUpDavServer(): void
    {
        Principal::query()->firstOrCreate(
            ['uri' => AdminConstants::GROUP_CONTAINER_URI],
            ['email' => null, 'displayname' => 'Groups'],
        );
        $dataDir = sys_get_temp_dir().'/wgw-collection-meta-'.uniqid('', true);
        mkdir($dataDir, 0775, true);
        config(['wgw.data_dir' => $dataDir]);
    }

    /**
     * @param  array<string, string>  $headers
     * @return array{status: int, body: string}
     */
    protected function davRequest(string $username, string $method, string $path, string $body = '', array $headers = []): array
    {
        $auth = 'Basic '.base64_encode($username.':secret');
        $_SERVER['HTTP_AUTHORIZATION'] = $auth;

        $server = app(SabreServerFactory::class)->create();
        $request = new SabreRequest($method, $path, ['Authorization' => $auth] + $headers, $body);
        $request->setBaseUrl('/');
        $response = new SabreResponse;
        $server->httpRequest = $request;
        $server->httpResponse = $response;
        try {
            $server->invokeMethod($request, $response, false);
        } catch (SabreDavException $e) {
            return ['status' => $e->getHTTPCode(), 'body' => $e->getMessage()];
        }

        $status = $response->getStatus();

        return ['status' => is_int($status) ? $status : 500, 'body' => (string) $response->getBodyAsString()];
    }

    /**
     * PROPPATCH the given properties ({ns}name => value) and assert that
     * every one of them was stored.
     *
     * @param  array<string, string>  $properties
     */
    protected function davProppatch(string $username, string $path, array $properties): void
    {
        $namespaces = [];
        $props = '';
        foreach ($properties as $clark => $value) {
            [$namespace, $name] = explode('}', ltrim($clark, '{'), 2);
            $prefix = $namespaces[$namespace] ??= 'n'.count($namespaces);
            $props .= '<'.$prefix.':'.$name.'>'.htmlspecialchars($value, ENT_XML1).'</'.$prefix.':'.$name.'>';
        }
        $xmlns = '';
        foreach ($namespaces as $namespace => $prefix) {
            $xmlns .= ' xmlns:'.$prefix.'="'.$namespace.'"';
        }
        $xml = '<?xml version="1.0" encoding="utf-8"?>'
            .'<d:propertyupdate xmlns:d="DAV:"'.$xmlns.'><d:set><d:prop>'.$props.'</d:prop></d:set></d:propertyupdate>';

        $response = $this->davRequest($username, 'PROPPATCH', $path, $xml, ['Content-Type' => 'application/xml']);

        $this->assertSame(207, $response['status'], 'PROPPATCH '.$path.': '.$response['body']);
        $this->assertStringContainsString('HTTP/1.1 200', $response['body'], 'PROPPATCH '.$path.': '.$response['body']);
        $this->assertStringNotContainsString('HTTP/1.1 403', $response['body'], 'PROPPATCH '.$path.': '.$response['body']);
        $this->assertStringNotContainsString('HTTP/1.1 424', $response['body'], 'PROPPATCH '.$path.': '.$response['body']);
    }

    /**
     * A `/changes` answer (REST or JMAP) that reports exactly this one
     * collection as updated, under a new state.
     *
     * @param  array<string, mixed>  $changes
     */
    protected function assertCollectionUpdated(array $changes, string $sinceState, string $collectionId, string $who): void
    {
        $this->assertNotSame($sinceState, $changes['newState'] ?? null, $who.': state must move');
        $this->assertSame([$collectionId], $changes['updated'] ?? null, $who.': collection must be reported as updated');
        $this->assertSame([], $changes['created'] ?? null, $who.': nothing created');
        $this->assertSame([], $changes['destroyed'] ?? null, $who.': nothing destroyed');
    }
}
