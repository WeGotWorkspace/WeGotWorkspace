<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Exceptions\ApiHttpException;
use App\Services\Calendars\CalendarEventRepository;
use App\Services\Calendars\CalendarRepository;
use App\Services\Jmap\JmapAccountStateCodec;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\JmapSetErrors;
use App\Services\Jmap\Methods\Concerns\ValidatesSetArguments;

/**
 * Calendar/set over the existing CalendarRepository create/update/delete,
 * wrapped in the RFC 8620 §5.3 SetResponse shape with genuine top-level
 * ifInState and envelope-codec oldState/newState. The client supports this
 * method but the adapter never calls it (spec dispatch table).
 */
final class CalendarSetMethod implements JmapMethodInterface
{
    use ValidatesSetArguments;

    public function __construct(
        private readonly CalendarRepository $calendars,
        private readonly CalendarEventRepository $events,
    ) {}

    public function name(): string
    {
        return 'Calendar/set';
    }

    public function capability(): string
    {
        return JmapCapabilities::CALENDARS;
    }

    public function requiresAccountId(): bool
    {
        return true;
    }

    public function handle(string $username, array $args): array
    {
        $oldState = JmapAccountStateCodec::compose($this->events->calendarSyncTokens($username));
        $this->guardIfInState($args, $oldState);
        [$create, $update, $destroy] = $this->setOperations($args);

        $created = [];
        $notCreated = [];
        foreach ($create as $creationId => $payload) {
            if (! is_array($payload)) {
                $notCreated[(string) $creationId] = ['type' => 'invalidProperties', 'description' => 'Calendar create entry must be an object.', 'properties' => []];

                continue;
            }
            try {
                $created[(string) $creationId] = CalendarRightsMapper::remap($this->calendars->create($username, $payload));
            } catch (ApiHttpException $e) {
                $notCreated[(string) $creationId] = JmapSetErrors::fromApiException($e);
            } catch (\Throwable $e) {
                $notCreated[(string) $creationId] = ['type' => 'serverFail', 'description' => $e->getMessage()];
            }
        }

        $updated = [];
        $notUpdated = [];
        foreach ($update as $calendarId => $patch) {
            if (! is_array($patch)) {
                $notUpdated[(string) $calendarId] = ['type' => 'invalidProperties', 'description' => 'Calendar update entry must be an object.', 'properties' => []];

                continue;
            }
            try {
                $this->calendars->update($username, (string) $calendarId, $patch);
                $updated[(string) $calendarId] = null;
            } catch (ApiHttpException $e) {
                $notUpdated[(string) $calendarId] = JmapSetErrors::fromApiException($e);
            } catch (\Throwable $e) {
                $notUpdated[(string) $calendarId] = ['type' => 'serverFail', 'description' => $e->getMessage()];
            }
        }

        $destroyed = [];
        $notDestroyed = [];
        $destroyOptions = ($args['onDestroyRemoveEvents'] ?? false) === true
            ? ['onDestroyRemoveContents' => true]
            : [];
        foreach ($destroy as $calendarId) {
            if (! is_string($calendarId) || $calendarId === '') {
                continue;
            }
            try {
                $this->calendars->delete($username, $calendarId, $destroyOptions);
                $destroyed[] = $calendarId;
            } catch (ApiHttpException $e) {
                $notDestroyed[$calendarId] = JmapSetErrors::fromApiException($e);
            } catch (\Throwable $e) {
                $notDestroyed[$calendarId] = ['type' => 'serverFail', 'description' => $e->getMessage()];
            }
        }

        return [
            'accountId' => $username,
            'oldState' => $oldState,
            'newState' => JmapAccountStateCodec::compose($this->events->calendarSyncTokens($username)),
            'created' => $created,
            'updated' => $updated,
            'destroyed' => $destroyed,
            'notCreated' => $notCreated,
            'notUpdated' => $notUpdated,
            'notDestroyed' => $notDestroyed,
        ];
    }
}
