<?php

declare(strict_types=1);

namespace App\Http\Requests\Api\V1;

use App\Http\Requests\Api\V1\Concerns\NarrowsValidatedInput;
use Illuminate\Foundation\Http\FormRequest;

final class CalendarSubscriptionCreateRequest extends FormRequest
{
    use NarrowsValidatedInput;

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
            'url' => ['required', 'string', 'min:1'],
            'name' => ['sometimes', 'nullable', 'string', 'min:1', 'max:255'],
            'color' => ['sometimes', 'nullable', 'string', 'max:32'],
            'groupSlug' => ['sometimes', 'nullable', 'string', 'min:1', 'max:64'],
        ];
    }

    /**
     * @return array{url: string, name?: string, color?: string|null, groupSlug?: string|null}
     */
    public function payload(): array
    {
        $validated = $this->validated();
        $payload = ['url' => $this->requiredString($validated['url'] ?? null)];
        if (isset($validated['name']) && is_string($validated['name'])) {
            $payload['name'] = $validated['name'];
        }
        if (array_key_exists('color', $validated)) {
            $payload['color'] = $this->nullableString($validated['color']);
        }
        if (array_key_exists('groupSlug', $validated)) {
            $payload['groupSlug'] = $this->nullableString($validated['groupSlug']);
        }

        return $payload;
    }
}
