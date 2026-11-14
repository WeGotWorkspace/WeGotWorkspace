<?php

declare(strict_types=1);

namespace App\Http\Requests\Api\V1;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Body of the batch acks, `POST /notifications/ack` (mark read, #2154) and
 * `POST /notifications/local-ack` (a visible window showed them, #1826): the
 * inbox rows to ack. The inbox returns at most 100 rows, so one batch holds
 * them all.
 */
final class NotificationIdBatchRequest extends FormRequest
{
    public const MAX_IDS = 100;

    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'ids' => ['required', 'array', 'list', 'min:1', 'max:'.self::MAX_IDS],
            'ids.*' => ['required', 'string', 'min:1', 'max:64', 'distinct'],
        ];
    }

    /**
     * @return list<string>
     */
    public function ids(): array
    {
        $ids = $this->validated()['ids'] ?? [];
        if (! is_array($ids)) {
            throw new \LogicException('FormRequest rules did not produce an id list.');
        }

        return array_values(array_map(static fn (mixed $id): string => (string) $id, $ids));
    }
}
