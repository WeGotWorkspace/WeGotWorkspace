<?php

declare(strict_types=1);

namespace Tests\Support\Ownership;

use App\Services\Jmap\JmapMethodDispatcher;
use App\Services\Jmap\Methods\JmapMethodInterface;
use Tests\Support\OpenApiContract;

/**
 * Every REST operation and JMAP method is either covered by an OwnershipSuite,
 * exempt with a reason, or pending for a named plan chunk. The coverage guard
 * (tests/Architecture/OwnershipMatrixCoverageTest.php) enforces that.
 *
 * Pending lists live in one method per chunk so parallel chunks do not edit
 * the same lines. A chunk removes its own entries as its suite covers them.
 */
final class OwnershipRegistry
{
    public const SUITE_NAMESPACE = 'Tests\\Feature\\Ownership\\';

    public static function jmapKey(string $methodName): string
    {
        return 'JMAP '.$methodName;
    }

    /**
     * @return list<string> REST keys ("GET /me") followed by JMAP keys ("JMAP Note/get")
     */
    public static function allOperations(): array
    {
        $jmap = [];
        foreach (JmapMethodDispatcher::METHODS as $class) {
            /** @var JmapMethodInterface $method */
            $method = app()->make($class);
            $jmap[] = self::jmapKey($method->name());
        }
        sort($jmap);

        return array_merge(OpenApiContract::documentedApiOperations(), $jmap);
    }

    /**
     * @return list<class-string<OwnershipSuite>>
     */
    public static function suites(): array
    {
        $dir = dirname(__DIR__, 2).'/Feature/Ownership';
        $suites = [];
        foreach (glob($dir.'/*.php') ?: [] as $file) {
            $class = self::SUITE_NAMESPACE.basename($file, '.php');
            if (class_exists($class) && is_subclass_of($class, OwnershipSuite::class)) {
                $suites[] = $class;
            }
        }
        sort($suites);

        return $suites;
    }

    /**
     * An operation counts as covered only through rows for a signed-in actor
     * (member or admin). Anonymous and guest rows prove the role gate, not
     * ownership, so cross-cutting suites may add them for any operation.
     *
     * @return array<string, list<class-string<OwnershipSuite>>> operation => suites that declare signed-in rows for it
     */
    public static function coveredOperations(): array
    {
        $covered = [];
        foreach (self::suites() as $suite) {
            foreach ($suite::ownershipCases() as $case) {
                if (! in_array($case->actor, Actor::signedIn(), true)) {
                    continue;
                }
                $covered[$case->operation] ??= [];
                if (! in_array($suite, $covered[$case->operation], true)) {
                    $covered[$case->operation][] = $suite;
                }
            }
        }
        ksort($covered);

        return $covered;
    }

    /**
     * @return array<string, array{reason: ExemptionReason, why: string}>
     */
    public static function exemptions(): array
    {
        $exempt = [];
        foreach (self::adminTargetOperations() as $operation) {
            $exempt[$operation] = [
                'reason' => ExemptionReason::AdminTarget,
                'why' => 'Admin endpoint that acts on other principals or the instance by design.',
            ];
        }

        $noObject = [
            'GET /health' => 'Liveness probe.',
            'GET /capabilities' => 'Static instance capabilities.',
            'POST /csp-reports' => 'Browser CSP report sink.',
            'GET /.well-known/jwks.json' => 'Public signing keys.',
            'GET /installer/bootstrap' => 'Pre-install wizard state, guarded by the installer session.',
            'POST /installer/action' => 'Pre-install wizard action, guarded by the installer session.',
            'GET /dav/capabilities' => 'Static DAV capabilities.',
            'GET /notifications/push/vapid-public-key' => 'Public VAPID key.',
            'GET /tasks/capabilities' => 'Static tasks capabilities.',
            'GET /jmap/events/{types}/{closeafter}/{ping}' => 'Event-source stub; path params are ignored.',
            'POST /auth/token' => 'Proves identity, not object access (spec non-goal).',
            'POST /auth/refresh' => 'Proves identity, not object access (spec non-goal).',
            'POST /auth/revoke' => 'Proves identity, not object access (spec non-goal).',
            'POST /auth/password-resets' => 'Proves identity, not object access (spec non-goal).',
            'POST /auth/password-resets/{token}' => 'Proves identity, not object access (spec non-goal).',
            self::jmapKey('Core/echo') => 'Echoes its own arguments.',
        ];
        foreach ($noObject as $operation => $why) {
            $exempt[$operation] = ['reason' => ExemptionReason::NoObject, 'why' => $why];
        }

        $selfOnly = [
            'GET /me' => 'Returns the caller principal.',
            'GET /files/context' => 'Returns the caller drive context.',
            'GET /settings/state' => 'Returns the caller settings.',
            'PUT /settings/profile' => 'Updates the caller profile.',
            'GET /jmap/session' => 'Returns the caller JMAP session.',
            'GET /calendars/availability' => "Returns the caller's own Team availability settings.",
            'PUT /calendars/availability' => "Writes only the caller's own settings rows; a calendarId outside the caller's own personal or Team event calendars is 422 (CalendarAvailabilitySettingsTest).",
        ];
        foreach ($selfOnly as $operation => $why) {
            $exempt[$operation] = ['reason' => ExemptionReason::SelfOnly, 'why' => $why];
        }

        $publicToken = [
            'GET /calendars/feeds/{token}' => 'Calendar feed capability token; PublicAccessOwnershipTest covers scope calendar-feed.',
            'GET /calendar/rsvp/{token}' => 'RSVP capability token; PublicAccessOwnershipTest covers scope rsvp.',
            'POST /calendar/rsvp/{token}' => 'RSVP capability token; PublicAccessOwnershipTest covers scope rsvp.',
            'POST /files/share-sessions' => 'Public link token exchange; PublicAccessOwnershipTest covers the link-* scopes.',
            'GET /jmap/download-ticket/{secret}/{name}' => 'Download ticket secret; DriveOwnershipTest covers who may mint a ticket for which blob or path.',
            'GET /jmap/folder-download-ticket/{secret}/{name}' => 'Folder download ticket secret; DriveOwnershipTest covers who may mint one for which folder.',
        ];
        foreach ($publicToken as $operation => $why) {
            $exempt[$operation] = ['reason' => ExemptionReason::PublicToken, 'why' => $why];
        }

        $exempt['POST /jmap'] = [
            'reason' => ExemptionReason::JmapEnvelope,
            'why' => 'Each JMAP method is declared as its own operation.',
        ];

        ksort($exempt);

        return $exempt;
    }

    /**
     * @return array<string, string> operation => plan chunk id
     */
    public static function pending(): array
    {
        $pending = [];
        foreach ([
            'chunk-b-calendars' => self::pendingCalendars(),
            'chunk-c-tasks' => self::pendingTasks(),
            'chunk-d-notes' => self::pendingNotes(),
            'chunk-e-chat' => self::pendingChat(),
            'chunk-f-contacts' => self::pendingContacts(),
            'chunk-g-drive' => self::pendingDrive(),
            'chunk-h-account' => self::pendingAccount(),
            'chunk-p-public' => self::pendingPublic(),
        ] as $chunk => $operations) {
            foreach ($operations as $operation) {
                $pending[$operation] = $chunk;
            }
        }
        ksort($pending);

        return $pending;
    }

    /**
     * @return list<string>
     */
    public static function chunkIds(): array
    {
        return [
            'chunk-b-calendars',
            'chunk-c-tasks',
            'chunk-d-notes',
            'chunk-e-chat',
            'chunk-f-contacts',
            'chunk-g-drive',
            'chunk-h-account',
            'chunk-p-public',
        ];
    }

    /**
     * @return list<string>
     */
    private static function adminTargetOperations(): array
    {
        return array_values(array_filter(
            OpenApiContract::documentedApiOperations(),
            static fn (string $operation): bool => str_contains($operation, ' /admin/'),
        ));
    }

    /**
     * @return list<string>
     */
    private static function pendingCalendars(): array
    {
        return [
        ];
    }

    /**
     * @return list<string>
     */
    private static function pendingTasks(): array
    {
        return [
        ];
    }

    /**
     * @return list<string>
     */
    private static function pendingNotes(): array
    {
        return [
        ];
    }

    /**
     * @return list<string>
     */
    private static function pendingChat(): array
    {
        return [
        ];
    }

    /**
     * @return list<string>
     */
    private static function pendingContacts(): array
    {
        return [
        ];
    }

    /**
     * @return list<string>
     */
    private static function pendingDrive(): array
    {
        return [
        ];
    }

    /**
     * @return list<string>
     */
    private static function pendingAccount(): array
    {
        return [
        ];
    }

    /**
     * @return list<string>
     */
    private static function pendingPublic(): array
    {
        return [
        ];
    }
}
