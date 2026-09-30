<?php

declare(strict_types=1);

namespace App\Dav;

use App\Http\Sabre\SabreHttpRequestFactory;
use App\Http\Sabre\SabreHttpResponseConverter;
use App\Services\Installer\InstallerWebBase;
use App\Support\AppPaths;
use Illuminate\Http\Request;
use Sabre\DAV;
use Sabre\DAV\Exception\NotAuthenticated;
use Sabre\DAV\Server;
use Sabre\HTTP;
use Symfony\Component\HttpFoundation\Response;

final class SabreWebdavFront
{
    public function __construct(
        private SabreServerFactory $factory,
        private AppPaths $paths,
        private SabreHttpRequestFactory $requestFactory,
        private SabreHttpResponseConverter $converter,
    ) {}

    /**
     * @deprecated Use {@see serve()} via Laravel routes.
     */
    public function handle(): void
    {
        $response = $this->serve(Request::capture());
        $response->send();
    }

    public function serve(Request $request): Response
    {
        if (! $this->paths->isInstalled()) {
            return $this->uninstalledResponse($request);
        }

        if ($request->headers->has('Authorization') && empty($_SERVER['HTTP_AUTHORIZATION'])) {
            $_SERVER['HTTP_AUTHORIZATION'] = (string) $request->headers->get('Authorization');
        }
        if (empty($_SERVER['HTTP_AUTHORIZATION']) && ! empty($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
            $_SERVER['HTTP_AUTHORIZATION'] = $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
        }

        $server = $this->factory->create();
        $httpRequest = $this->requestFactory->fromLaravelRequest($request);
        $httpRequest->setBaseUrl($server->getBaseUri());
        $httpResponse = new HTTP\Response;
        $httpResponse->setHTTPVersion($httpRequest->getHTTPVersion());

        // Browser plugin writes to $server->httpResponse (not only the invokeMethod argument).
        $server->httpRequest = $httpRequest;
        $server->httpResponse = $httpResponse;

        try {
            $server->invokeMethod($httpRequest, $httpResponse, false);
        } catch (NotAuthenticated) {
            return $this->converter->toIlluminate($httpResponse);
        } catch (\Throwable $e) {
            return $this->converter->toIlluminate($this->exceptionResponse($server, $e));
        }

        return $this->converter->toIlluminate($httpResponse);
    }

    private function uninstalledResponse(Request $request): Response
    {
        $method = strtoupper($request->method());
        if (in_array($method, ['GET', 'HEAD'], true) && ! $request->query->has('sabreAction')) {
            return InstallerWebBase::redirectToInstallWizard();
        }

        return response(
            "WeGotWorkspace is not installed. Open /install/ to finish setup.\n",
            503,
            ['Content-Type' => 'text/plain; charset=utf-8']
        );
    }

    private function exceptionResponse(Server $server, \Throwable $e): HTTP\Response
    {
        try {
            $server->emit('exception', [$e]);
        } catch (\Exception) {
        }

        $dom = new \DOMDocument('1.0', 'utf-8');
        $dom->formatOutput = true;
        $error = $dom->createElementNS('DAV:', 'd:error');
        $error->setAttribute('xmlns:s', Server::NS_SABREDAV);
        $dom->appendChild($error);

        $h = static fn (mixed $v): string => htmlspecialchars((string) $v, ENT_NOQUOTES, 'UTF-8');
        if (Server::$exposeVersion) {
            $error->appendChild($dom->createElement('s:sabredav-version', $h(DAV\Version::VERSION)));
        }
        $error->appendChild($dom->createElement('s:exception', $h($e::class)));
        $error->appendChild($dom->createElement('s:message', $h($e->getMessage())));

        if ($e instanceof DAV\Exception) {
            $httpCode = $e->getHTTPCode();
            $headers = $e->getHTTPHeaders($server);
        } else {
            $httpCode = 500;
            $headers = [];
        }
        $headers['Content-Type'] = 'application/xml; charset=utf-8';

        $response = new HTTP\Response;
        $this->copyResponseHeaders($server->httpResponse, $response);
        $response->setStatus($httpCode);
        foreach ($headers as $name => $value) {
            $response->setHeader($name, $value);
        }
        $xml = $dom->saveXML();
        if (is_string($xml)) {
            $response->setBody($xml);
        }

        return $response;
    }

    private function copyResponseHeaders(HTTP\Response $from, HTTP\Response $to): void
    {
        foreach ($from->getHeaders() as $name => $value) {
            $to->setHeader($name, $value);
        }
    }
}
