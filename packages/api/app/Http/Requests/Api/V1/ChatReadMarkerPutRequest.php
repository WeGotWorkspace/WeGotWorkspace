<?php

declare(strict_types=1);

namespace App\Http\Requests\Api\V1;

use Illuminate\Foundation\Http\FormRequest;

final class ChatReadMarkerPutRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'lastReadTs' => ['required', 'string', 'date'],
            'lastReadUid' => ['required', 'string', 'max:26'],
        ];
    }
}
