<?php

declare(strict_types=1);

namespace App\Http\Requests\Api\V1;

use App\Http\Requests\Api\V1\Concerns\NarrowsValidatedInput;
use Illuminate\Foundation\Http\FormRequest;

final class AdminGroupUpdateRequest extends FormRequest
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
            'displayName' => ['sometimes', 'nullable', 'string', 'max:255'],
            'members' => ['sometimes', 'array'],
            'members.*' => ['string', 'max:255'],
        ];
    }

    /**
     * @return array{displayName: string|null, members: list<string>|null}
     */
    public function payload(): array
    {
        $validated = $this->validated();
        $displayName = null;
        if (array_key_exists('displayName', $validated)) {
            $raw = $validated['displayName'];
            $displayName = trim(is_string($raw) ? $raw : '');
        }

        return [
            'displayName' => $displayName,
            'members' => array_key_exists('members', $validated) && is_array($validated['members'])
                ? $this->stringList($validated['members'])
                : null,
        ];
    }
}
