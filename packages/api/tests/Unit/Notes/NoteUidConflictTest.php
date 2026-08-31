<?php

declare(strict_types=1);

namespace Tests\Unit\Notes;

use App\Exceptions\ApiHttpException;
use App\Services\Notes\NoteUidConflict;
use Illuminate\Database\QueryException;
use PDOException;
use PHPUnit\Framework\TestCase;

final class NoteUidConflictTest extends TestCase
{
    public function test_query_exception_unique_violation_is_409(): void
    {
        $this->assertUidConflictMapsTo409(new QueryException(
            'wgw',
            'insert',
            [],
            new PDOException('UNIQUE constraint failed: calendarobjects.calendarid_uid'),
        ));
    }

    public function test_pdo_exception_unique_violation_is_409(): void
    {
        $this->assertUidConflictMapsTo409(
            new PDOException('SQLSTATE[23000]: Integrity constraint violation: 1062 Duplicate entry for key calendarid_uid'),
        );
    }

    private function assertUidConflictMapsTo409(\Throwable $exception): void
    {
        try {
            NoteUidConflict::throwIf($exception);
            $this->fail('Expected ApiHttpException');
        } catch (ApiHttpException $e) {
            $this->assertSame(409, $e->getStatusCode());
            $this->assertSame('alreadyExists', $e->errorCode());
        }
    }
}
