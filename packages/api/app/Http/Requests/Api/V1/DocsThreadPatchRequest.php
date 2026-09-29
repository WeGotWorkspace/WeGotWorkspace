<?php

declare(strict_types=1);

namespace App\Http\Requests\Api\V1;

use App\Http\Requests\Api\V1\Concerns\NarrowsValidatedInput;
use Illuminate\Foundation\Http\FormRequest;

final class DocsThreadPatchRequest extends FormRequest
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
            'resolved' => ['sometimes', 'boolean'],
            'archived' => ['sometimes', 'boolean'],
            'changeId' => ['sometimes', 'nullable', 'string', 'max:128'],
            'anchorText' => ['sometimes', 'nullable', 'string'],
            'anchorFrom' => ['sometimes', 'nullable', 'integer'],
            'anchorTo' => ['sometimes', 'nullable', 'integer'],
        ];
    }

    /**
     * @return array{resolved?: bool, archived?: bool, changeId?: string, anchorText?: string|null, anchorFrom?: int|null, anchorTo?: int|null}
     */
    public function payload(): array
    {
        $validated = $this->validated();
        $payload = [];
        if (array_key_exists('resolved', $validated)) {
            $payload['resolved'] = $this->requiredBool($validated['resolved']);
        }
        if (array_key_exists('archived', $validated)) {
            $payload['archived'] = $this->requiredBool($validated['archived']);
        }
        if (isset($validated['changeId']) && is_string($validated['changeId'])) {
            $payload['changeId'] = $validated['changeId'];
        }
        if (array_key_exists('anchorText', $validated)) {
            $payload['anchorText'] = $this->nullableString($validated['anchorText']);
        }
        if (array_key_exists('anchorFrom', $validated)) {
            $payload['anchorFrom'] = $this->nullableInt($validated['anchorFrom']);
        }
        if (array_key_exists('anchorTo', $validated)) {
            $payload['anchorTo'] = $this->nullableInt($validated['anchorTo']);
        }

        return $payload;
    }
}
