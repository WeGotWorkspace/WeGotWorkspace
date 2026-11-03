<?php

declare(strict_types=1);

namespace App\Http\Requests\Api\V1;

use Illuminate\Foundation\Http\FormRequest;

final class AdminUpdateChannelSaveRequest extends FormRequest
{
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
            'channel' => ['required', 'string'],
        ];
    }

    /** Exactly as sent: the contract allows only lowercase stable, beta, or edge (422 otherwise). */
    public function channelValue(): string
    {
        return (string) $this->validated('channel');
    }
}
