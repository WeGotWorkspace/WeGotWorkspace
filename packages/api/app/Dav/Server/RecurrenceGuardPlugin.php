<?php

declare(strict_types=1);

namespace App\Dav\Server;

use App\Exceptions\ApiHttpException;
use App\Services\Calendars\RecurrenceRuleGuard;
use Sabre\DAV\Exception\BadRequest;
use Sabre\DAV\Server;
use Sabre\DAV\ServerPlugin;
use Sabre\HTTP\Request;
use Sabre\HTTP\RequestInterface;
use Sabre\HTTP\ResponseInterface;
use Sabre\VObject\Component\VCalendar;
use Sabre\VObject\Reader;

/**
 * CalDAV PUT: reject minutely and secondly recurrence before the object is stored.
 */
final class RecurrenceGuardPlugin extends ServerPlugin
{
    public function initialize(Server $server): void
    {
        $server->on('beforeMethod:PUT', [$this, 'beforePut']);
    }

    public function beforePut(RequestInterface $request, ResponseInterface $response): void
    {
        $path = trim((string) $request->getPath(), '/');
        if ($this->parseCalendarObjectPath($path) === null) {
            return;
        }

        $ics = $this->requestBody($request);
        if (trim($ics) === '') {
            return;
        }

        try {
            $document = Reader::read($ics);
        } catch (\Throwable) {
            return;
        }
        if (! $document instanceof VCalendar) {
            return;
        }

        try {
            RecurrenceRuleGuard::assertAllowed($document);
        } catch (ApiHttpException $exception) {
            throw new BadRequest($exception->getMessage());
        }
    }

    private function requestBody(RequestInterface $request): string
    {
        $body = $request->getBody();
        if (! is_resource($body)) {
            return $request->getBodyAsString();
        }

        $contents = stream_get_contents($body);
        $text = is_string($contents) ? $contents : '';
        if ($request instanceof Request) {
            $request->setBody($text);
        } elseif (stream_get_meta_data($body)['seekable']) {
            rewind($body);
        }

        return $text;
    }

    /**
     * @return array{principalUri: string, calendarUri: string, objectUri: string}|null
     */
    private function parseCalendarObjectPath(string $path): ?array
    {
        $path = trim($path, '/');
        if (! str_starts_with($path, 'calendars/')) {
            return null;
        }
        $rest = substr($path, strlen('calendars/'));
        if ($rest === '' || str_contains($rest, '/inbox/')) {
            return null;
        }

        $segments = explode('/', $rest);
        if (count($segments) < 3) {
            return null;
        }

        $objectUri = array_pop($segments);
        $calendarUri = array_pop($segments);
        if ($calendarUri === 'inbox') {
            return null;
        }
        if ($calendarUri === '' || $objectUri === '') {
            return null;
        }

        $principalName = implode('/', $segments);
        if ($principalName === 'inbox') {
            return null;
        }

        return [
            'principalUri' => 'principals/'.$principalName,
            'calendarUri' => $calendarUri,
            'objectUri' => $objectUri,
        ];
    }
}
