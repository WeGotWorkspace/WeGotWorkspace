<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Services\Mcp\CimdException;
use App\Services\Mcp\CimdResolver;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class ResolveCimdClient
{
    public function __construct(private CimdResolver $cimd) {}

    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        if (! $request->is('oauth/authorize') && ! $request->is('oauth/token')) {
            return $next($request);
        }

        $clientId = $request->input('client_id') ?? $request->query('client_id');
        if (! is_string($clientId) || ! $this->cimd->looksLikeMetadataUrl($clientId)) {
            return $next($request);
        }

        try {
            $client = $this->cimd->resolve($clientId);
        } catch (CimdException $e) {
            return response()->json([
                'error' => 'invalid_client',
                'error_description' => $e->getMessage(),
            ], $e->status());
        }

        $uuid = (string) $client->getKey();
        $request->merge(['client_id' => $uuid]);
        $request->query->set('client_id', $uuid);
        $request->request->set('client_id', $uuid);

        return $next($request);
    }
}
