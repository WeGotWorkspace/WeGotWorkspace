<?php

declare(strict_types=1);

namespace App\Http\Requests\Api\V1;

use App\Http\Requests\Api\V1\Concerns\NarrowsValidatedInput;
use Illuminate\Foundation\Http\FormRequest;

final class ChatMessageCreateRequest extends FormRequest
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
            'parentId' => ['sometimes', 'nullable', 'string', 'max:26'],
            'mentions' => ['sometimes', 'array'],
            'mentions.*.id' => ['required_with:mentions', 'string', 'max:64'],
            'mentions.*.displayName' => ['sometimes', 'string', 'max:255'],
        ];
    }

    /**
     * @return array{id: string, body: string, parentId?: string|null, mentions?: list<array{id: string, displayName?: string}>}
     */
    public function payload(): array
    {
        $validated = $this->validated();
        $payload = [
            'id' => $this->requiredString($validated['id'] ?? null),
            'body' => $this->requiredString($validated['body'] ?? null),
        ];
        if (array_key_exists('parentId', $validated)) {
            $payload['parentId'] = $this->nullableString($validated['parentId']);
        }
        if (array_key_exists('mentions', $validated)) {
            $payload['mentions'] = $this->mentionList($validated['mentions']);
        }

        return $payload;
    }

    /**
     * @return list<array{id: string, displayName?: string}>
     */
    private function mentionList(mixed $value): array
    {
        if (! is_array($value)) {
            return [];
        }

        $mentions = [];
        foreach ($value as $entry) {
            if (! is_array($entry)) {
                continue;
            }
            $id = $entry['id'] ?? null;
            if (! is_string($id) || $id === '') {
                continue;
            }
            $mention = ['id' => $id];
            $displayName = $entry['displayName'] ?? null;
            if (is_string($displayName)) {
                $mention['displayName'] = $displayName;
            }
            $mentions[] = $mention;
        }

        return $mentions;
    }
}
