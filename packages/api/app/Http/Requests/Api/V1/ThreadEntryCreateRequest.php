<?php

declare(strict_types=1);

namespace App\Http\Requests\Api\V1;

use App\Http\Requests\Api\V1\Concerns\NarrowsValidatedInput;
use Illuminate\Foundation\Http\FormRequest;

/**
 * POST /threads/{subjectType}/{subjectId}/entries (#2173). The body size limit
 * is checked by the thread core (413), not here.
 */
final class ThreadEntryCreateRequest extends FormRequest
{
    use NarrowsValidatedInput;

    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'id' => ['required', 'string', 'max:26'],
            'body' => ['required', 'string', 'min:1'],
            'parentId' => ['nullable', 'string', 'max:26'],
            'scopeId' => ['nullable', 'string', 'max:255'],
            'mentions' => ['nullable', 'array', 'max:50'],
            'mentions.*.id' => ['required', 'string', 'max:255'],
            'mentions.*.displayName' => ['nullable', 'string', 'max:255'],
        ];
    }

    /**
     * @return array{id: string, body: string, parentId: string|null, scopeId: string|null, mentions: list<array{id: string, displayName?: string}>}
     */
    public function payload(): array
    {
        $validated = $this->validated();
        $mentions = [];
        foreach ((array) ($validated['mentions'] ?? []) as $mention) {
            if (! is_array($mention)) {
                continue;
            }
            $row = ['id' => $this->requiredString($mention['id'] ?? null)];
            $display = $this->nullableString($mention['displayName'] ?? null);
            if ($display !== null) {
                $row['displayName'] = $display;
            }
            $mentions[] = $row;
        }

        return [
            'id' => $this->requiredString($validated['id'] ?? null),
            'body' => $this->requiredString($validated['body'] ?? null),
            'parentId' => $this->nullableString($validated['parentId'] ?? null),
            'scopeId' => $this->nullableString($validated['scopeId'] ?? null),
            'mentions' => $mentions,
        ];
    }
}
