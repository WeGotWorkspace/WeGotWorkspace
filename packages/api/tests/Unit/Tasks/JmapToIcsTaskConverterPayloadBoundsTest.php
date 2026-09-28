<?php

declare(strict_types=1);

namespace Tests\Unit\Tasks;

use App\Exceptions\ApiHttpException;
use App\Services\Tasks\Conversion\JmapToIcsTaskConverter;
use App\Services\VObject\VObjectPayloadGuard;
use PHPUnit\Framework\TestCase;

final class JmapToIcsTaskConverterPayloadBoundsTest extends TestCase
{
    public function test_ics_from_task_rejects_serialized_payload_over_size_cap(): void
    {
        $converter = new JmapToIcsTaskConverter;
        $task = [
            'uid' => 'urn:uuid:oversized-task',
            'title' => 'Huge',
            'description' => str_repeat('x', VObjectPayloadGuard::MAX_ICS_BYTES),
            'workflowStatus' => 'needs-action',
        ];

        try {
            $converter->icsFromTask($task);
            $this->fail('Expected ApiHttpException');
        } catch (ApiHttpException $e) {
            $this->assertSame(413, $e->getStatusCode());
            $this->assertSame(VObjectPayloadGuard::ERROR_PAYLOAD_TOO_LARGE, $e->errorCode());
        }
    }
}
