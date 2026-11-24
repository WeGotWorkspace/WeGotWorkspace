<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Support\TrafficBudget;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/** Tells the browser's request governor the traffic budget on every API answer. */
final class SendTrafficBudget
{
    public function handle(Request $request, Closure $next): Response
    {
        /** @var Response $response */
        $response = $next($request);
        $response->headers->set(TrafficBudget::HEADER, TrafficBudget::header());

        return $response;
    }
}
