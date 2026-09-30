<?php

declare(strict_types=1);

namespace App\Http\Sabre;

use Illuminate\Http\Request;
use Sabre\HTTP\Request as SabreRequest;
use Sabre\HTTP\Sapi;

/**
 * Build a Sabre HTTP request from Laravel's request so PUT/PATCH bodies are preserved
 * (php://input is often already consumed by the framework).
 */
final class SabreHttpRequestFactory
{
    public function fromLaravelRequest(Request $request): SabreRequest
    {
        $server = $_SERVER;
        $server['REQUEST_METHOD'] = $request->method();
        $server['REQUEST_URI'] = $request->getRequestUri();

        $sabre = Sapi::createFromServerArray($server);

        foreach ($request->headers->all() as $name => $values) {
            if ($values === []) {
                continue;
            }
            $header = $values[0];
            if (! is_string($header)) {
                continue;
            }
            $sabre->setHeader($name, $header);
        }

        $length = $request->headers->get('Content-Length');
        $hasBody = ($length !== null && (int) $length > 0)
            || in_array($request->method(), ['PUT', 'PATCH', 'POST'], true);

        if ($hasBody) {
            $body = $request->getContent(true);
            if (is_resource($body)) {
                $sabre->setBody($body);
            } else {
                $content = $request->getContent();
                if ($content !== '') {
                    $sabre->setBody($content);
                }
            }
        }

        return $sabre;
    }
}
